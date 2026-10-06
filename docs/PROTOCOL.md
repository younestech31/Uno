# CardClash Wire Protocol (`docs/PROTOCOL.md`)

This document defines the Socket.IO real-time protocol shared between `apps/web`, `apps/server`, and `packages/protocol`.

---

## 1. Authentication & Identity (`socket.handshake.auth`)

CardClash never uses `socket.id` to identify players. Every client must present an HMAC-SHA256 signed session token in the Socket.IO handshake:

```ts
import { io } from 'socket.io-client';

const socket = io(SERVER_URL, {
  auth: {
    token: signedSessionToken, // "<base64url(payload)>.<base64url(hmac)>"
  },
});
```

- **Token Payload (`SessionIdentity`)**:
  - `playerId`: `string` (stable player identifier)
  - `name`: `string` (display name)
  - `email`: `string | null` (optional verified account email)
  - `isGuest`: `boolean` (true for instant guest session, false for account)
  - `iat`: `number` (issued-at epoch timestamp in ms)
- **Rejection**: If `auth.token` is missing, malformed, or fails HMAC-SHA256 verification against `SESSION_SECRET`, the connection is rejected in middleware with `UNAUTHORIZED: Invalid or missing session token`.
- **Personal Delivery Channel**: On connection, the server binds the socket to room `player:${identity.playerId}`. Private game states (`game:view`) are emitted exclusively to `player:${playerId}`.
- **Automatic Token Reconnect**: When a player reconnects with a valid signed session token, the server looks up their active room in `StateStore` (`getPlayerRoom(playerId)`), restores their seat (`connected: true`, `isBot: false`, `disconnectedAt: null`), cancels any pending 60-second disconnect grace timer, and immediately pushes `room:state` and `game:view` (with `turnDeadlineAt`).

---

## 2. Rate Limiting

Every socket connection has a dedicated sliding-window rate limiter (`SocketRateLimiter`, default `20` events per `1000ms` window).
- When exceeded, the server emits `error:event` (and invokes the callback acknowledgement if provided) with:
  ```json
  {
    "ok": false,
    "error": {
      "code": "RATE_LIMITED",
      "message": "Too many requests; please slow down"
    }
  }
  ```

---

## 3. Client $\rightarrow$ Server Events (Intents)

All client events support an optional Socket.IO acknowledgement callback returning `SocketAckResult<T>`:
- Success: `{ ok: true, data: T }`
- Failure: `{ ok: false, error: { code: string, message: string } }`

### `session:heartbeat`
Refreshes the caller's presence record in `StateStore` (Redis or In-Memory) and returns authoritative server time and active turn deadline metadata.

- **Payload (`SessionHeartbeatIntent`, optional)**:
  ```json
  {
    "clientTime": 1760000000000
  }
  ```
- **Ack Response (`HeartbeatAckPayload`)**:
  ```json
  {
    "ok": true,
    "data": {
      "serverTime": 1760000000012,
      "roomCode": "K7M2",
      "turnDeadlineAt": 1760000028500
    }
  }
  ```

### `room:create`
Creates a new game room with a unique 4-letter uppercase code (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) and seats the caller as host.

- **Payload (`RoomCreateIntent`, optional)**:
  ```json
  {
    "houseRules": {
      "stacking": false,
      "sevenZeroSwap": false,
      "jumpIn": false,
      "wildDrawFourChallenge": false
    },
    "targetScore": 500,
    "maxPlayers": 4
  }
  ```
- **Ack Response**: `{ ok: true, data: { room: PublicRoomState } }`
- **Broadcast**: Emits `room:state` to `room:${roomCode}`.

### `room:join`
Joins an existing lobby by its 4-letter room code, or reconnects to an existing seat if `playerId` is already a member of the room.

- **Payload (`RoomJoinIntent`)**:
  ```json
  {
    "roomCode": "K7M2"
  }
  ```
- **Ack Response**: `{ ok: true, data: { room: PublicRoomState } }`
- **Broadcast**: Emits `room:state` to `room:${roomCode}`.

### `room:spectate`
Joins an active room as a non-playing spectator without consuming player seats. Receives live spectator game views and chat broadcasts.

- **Payload (`RoomSpectateIntent`)**:
  ```json
  {
    "roomCode": "K7M2"
  }
  ```
- **Ack Response**: `{ ok: true, data: { room: PublicRoomState } }`
- **Broadcast**: Emits `room:state` with updated `spectatorCount` to `room:${roomCode}`.

### `room:ready`
Toggles readiness for seated players in the lobby.

- **Payload (`RoomReadyIntent`)**:
  ```json
  {
    "roomCode": "K7M2",
    "ready": true
  }
  ```

### `room:start`
Starts a match from the lobby (Host only, min 2 seated players, all marked ready). Generates a 32-byte cryptographic random seed, initializes `createGame()`, and starts the 30s turn timer.

- **Payload (`RoomStartIntent`, optional)**: `{ "roomCode": "K7M2" }`
- **Broadcast**: Broadcasts `room:state` (`status: "IN_GAME"`), `game:events` (initial deal), and per-player private `game:view` envelopes.

### `room:rematch`
Resets the match with the same players and house rules after `MATCH_OVER`.

- **Payload (`RoomRematchIntent`, optional)**: `{ "roomCode": "K7M2" }`

### `room:leave`
Leaves the current room or seat. If host leaves, leadership transfers to the next seated member.

- **Payload (`RoomLeaveIntent`, optional)**: `{ "roomCode": "K7M2" }`

### `game:action`
Dispatches a strictly validated player intent to the authoritative engine.

- **Payload (`GameActionEnvelope` or direct `ClientGameActionIntent`)**:
  ```json
  {
    "roomCode": "K7M2",
    "action": {
      "type": "PLAY_CARD",
      "cardId": "RED-7-A",
      "chosenColor": "RED",
      "callUno": false,
      "seq": 1
    }
  }
  ```

### `chat:send`
Sends a moderated chat message or emoji reaction to the room.

- **Payload (`ChatSendIntent`)**:
  ```json
  {
    "roomCode": "K7M2",
    "text": "Good luck everyone!",
    "emoji": "🔥"
  }
  ```
- **Moderation**: Server validates rate limit (max 5 msg / 10s), masks profanity with asterisks, and blocks external URLs.
- **Broadcast**: Emits `chat:message` (`ChatMessagePayload`) to `room:${roomCode}`.

### `chat:report`
Reports an inappropriate chat message for moderation review.

- **Payload (`ChatReportIntent`)**:
  ```json
  {
    "roomCode": "K7M2",
    "messageId": "msg_1760000000_abc123",
    "reason": "Harassment"
  }
  ```

---

## 4. Server $\rightarrow$ Client Events (Broadcasts)

### `room:state` (`PublicRoomState`)
Emitted on room creation, player joins/leaves, readiness updates, and match phase transitions.

### `game:view` (`GameViewBroadcast`)
Emitted to individual player channels `player:${playerId}` with their private hand, opponent card counts, and active turn deadline. Also emitted with empty hands to spectators.

### `game:events` (`GameEventsBroadcast`)
Broadcast to the room channel for visual and auditory SFX feedback (cards played, draws, UNO calls, penalties, winner toasts).

### `chat:message` (`ChatMessagePayload`)
Broadcast to the room channel when a valid message or emoji reaction is submitted.

### `error:event` (`ProtocolErrorPayload`)
Emitted to a socket when an action fails validation or violates rules.

---

## 5. HTTP & Replay API

- `POST /api/session/guest`: Issues signed guest session token.
- `POST /api/auth/session`: Issues verified Auth.js-compatible account session token.
- `GET /api/leaderboard`: Returns OpenSkill global standings and recent matches.
- `GET /api/matches/:id/replay`: Returns deterministic `ReplayDataBundle` (seed, player configs, house rules, ordered action log, and events) for client-side frame-by-frame scrubbing.

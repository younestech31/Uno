# Fix Room Exit & Serverless Synchronization Bugs

This plan resolves the issue where leaving a room—either in the lobby or mid-game on the deployed website—causes the interface to get stuck or bounce back into the active room due to stale serverless snapshot tokens and polling race conditions.

## User Review & Critical Decisions

> [!IMPORTANT]
> Both key behavioral preferences have been confirmed from your answers and are incorporated directly into this plan.

- **Confirmed Decision 1 (Immediate Client Exit)**: Tapping **Leave Room** in a lobby or mid-game immediately exits to the home screen and clears all local room and session snapshot state without waiting on network round-trips.
- **Confirmed Decision 2 (Server Room Cleanup)**: When a player leaves a room and no connected human players remain in that room (whether in the lobby or mid-game), the server immediately closes and deletes the room snapshot.

---

## 1. Overview & Core Concept

- **What It Does**: Guarantees a clean, instantaneous exit to the home screen whenever a player leaves a lobby or an active match, while preventing background serverless polling (`room:sync`) or local companion bot teardown from re-hydrating the room.
- **Target Audience / Persona**: Players on the deployed serverless website creating rooms, playing with local companion bots, or leaving mid-game to start a new match.
- **Key Value**: Eliminates the stuck room loop on deployed environments and ensures abandoned rooms are immediately cleaned up on both client and server.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Lobby Exit**: User clicks **Leave Room** in the lobby -> UI transitions immediately (`0ms` blocking delay) back to the Home view -> Local `sessionStorage` room keys and companion seat sockets are purged -> Server deletes the room if no human players remain.
  2. **Mid-Game Exit**: User clicks **Leave** from the top HUD bar during an active match -> Polling stops immediately, local game views and turn timers reset, and the user lands cleanly on the Home screen ready to create or join a new room.
- **Visual Identity & Theme**:
  - Preserves the existing **Emerald Felt (`#0B2B26`)** table aesthetic, high-contrast stone typography, and responsive HUD bar controls.
- **Interactive Feedback & Motion**:
  - Instant view transition from the Lobby or Card Table back to the Home screen without frozen buttons or ghost toast notifications from the departed match.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Optimistic Client State Reset + Synchronous SessionStorage Purge**
  - *Chosen Approach*: Clear `room`, `viewsBySeat`, `turnDeadlineAt`, `lastActionText`, and `sessionStorage` keys (`cardclash_active_room` and `cardclash_snapshot_<roomCode>`) synchronously at the very start of the leave handler before firing background `room:leave` teardown requests.
  - *Why*: In serverless mode, waiting for the `room:leave` HTTP callback before clearing state allows the 1.5-second `pollSync` interval and companion seat leave responses to re-save the room snapshot token and push the user back into the room.
  - *Alternatives Considered*: Waiting for sequential RPC responses from each companion seat and primary player—rejected because network latency or serverless cold starts make the button feel unresponsive.
- **Decision 2: Guarding `ServerlessFallbackSocket` Against Stale Leave Broadcasts**
  - *Chosen Approach*: When `ServerlessFallbackSocket` processes a `room:leave` event, it immediately halts background sync for that room, removes stored snapshot tokens, and suppresses re-triggering `ROOM_STATE` on the leaving client.
  - *Why*: Prevents race conditions where a leaving companion seat returns a non-null `room` payload that overwrites the primary player's cleared state.
- **Decision 3: Server-Side Cleanup When No Connected Humans Remain**
  - *Chosen Approach*: Update `RoomManager.leaveRoom` so that even during `IN_GAME` or `FINISHED` states, if no connected non-bot players remain after the player leaves (or if the host leaves a solo/companion match), the room snapshot and player-room mappings are deleted immediately.
  - *Why*: Matches user expectations that leaving a solo/companion match or being the last human to leave closes the room rather than leaving a zombie match in memory.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Leave Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Client: CardClashApp                             │
│  User clicks "Leave Room" (Lobby or Mid-Game HUD)                       │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. Immediate Local State & Storage Purge (Synchronous)                  │
│  • Clear sessionStorage: cardclash_active_room & cardclash_snapshot_*   │
│  • Disconnect & remove all companion seats without re-broadcasting      │
│  • Reset React state: room = null, viewsBySeat = {}, deadline = null    │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. ServerlessFallbackSocket / Socket.IO Teardown                        │
│  • Suppress ROOM_STATE re-hydration on ROOM_LEAVE response              │
│  • Guard pollSync() so it aborts if active_room is null or leaving      │
│  • Send room:leave RPC with roomCode & last snapshotToken               │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. Server: RoomManager.leaveRoom & /api/rpc                             │
│  • Clear player -> room mapping in StateStore                           │
│  • If status === LOBBY or no connected human players remain:            │
│      -> Delete room snapshot & clear all remaining player mappings      │
│      -> Return { room: null } (no snapshotToken re-issued)              │
└─────────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & State Mapping

- **Client Leave Handler**:
  - Captures `currentRoomCode = room.roomCode` and primary/companion seat references.
  - Immediately clears `window.sessionStorage.removeItem('cardclash_active_room')` and `window.sessionStorage.removeItem('cardclash_snapshot_' + currentRoomCode)`.
  - Resets `setRoom(null)`, `setViewsBySeat({})`, `setTurnDeadlineAt(null)`, and `setLastActionText(null)` synchronously so the user returns to the Home screen right away.
  - Disconnects companion sockets first so their polling loops stop, then emits `ROOM_LEAVE` to clean up server state.
- **Serverless Transport Layer (`ServerlessFallbackSocket`)**:
  - On `SOCKET_EVENTS.ROOM_LEAVE`, clears stored snapshot tokens prior to `fetch('/api/rpc')` and skips saving any returned `snapshotToken` or emitting `SOCKET_EVENTS.ROOM_STATE` / `cardclash_sync_broadcast` for the leaving player.
  - In `pollSync()`, verifies before and after the `fetch('/api/rpc')` call that `cardclash_active_room` is still set to the polled `roomCode` so an in-flight poll that started right before clicking Leave cannot restore the room after the user has exited.
- **Server Room Manager (`RoomManager.leaveRoom`)**:
  - Checks remaining players after marking/removing the leaving player. If no remaining player has `connected === true && !isBot`, deletes the room snapshot via `deleteRoomSnapshot(roomCode)` and clears player-room bindings for all seats in that room.

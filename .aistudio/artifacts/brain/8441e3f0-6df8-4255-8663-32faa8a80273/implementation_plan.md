# Standalone Vercel Compatibility & Dual-Transport Fallback Plan

Remove the dead hardcoded Cloud Run URL so session and leaderboard requests always talk directly to your deployed app origin, and add a built-in Next.js Serverless HTTP/RPC transport fallback so room creation, companion seats, and full gameplay work out-of-the-box on Vercel without requiring an external Socket.IO host.

## User Review & Critical Decisions

> [!IMPORTANT]
> Confirmed in Phase 1:
> - **Remove Hardcoded Cloud Run URL**: All session (`/api/session/guest`, `/api/auth/session`) and leaderboard (`/api/leaderboard`) calls will use the current site origin (`window.location.origin`), fixing `Session Error: Failed to fetch` on `unodz.vercel.app`.
> - **Built-In Vercel Standalone HTTP/RPC Transport**: When deployed on Vercel without an external `NEXT_PUBLIC_SOCKET_URL`, the client automatically uses a built-in Next.js App Router RPC endpoint (`/api/rpc`) with signed state hydration so creating rooms, joining, adding companion bots, and playing full matches work natively on Vercel Serverless.

- **Confirmed Decision 1**: Remove the dead `ais-pre-...run.app` fallback URL from the client.
- **Confirmed Decision 2**: Add an automatic Next.js `/api/rpc` fallback transport for standalone Vercel deployments while preserving native Socket.IO support when `NEXT_PUBLIC_SOCKET_URL` or `server.ts` is used.

---

## 1. Overview & Core Concept

- **What It Does**:
  1. Fixes `POST /api/session/guest` on Vercel by always calling the current origin (`window.location.origin`) unless `NEXT_PUBLIC_SOCKET_URL` is explicitly configured.
  2. Provides a seamless Dual-Transport Client (`Socket.IO` + `HTTP RPC Fallback`) backed by a Next.js App Router endpoint (`POST /api/rpc`).
  3. Includes HMAC-signed room snapshot continuity so even if Vercel scales across multiple stateless serverless function instances without Redis, active rooms and matches never drop or 404.
- **Target Audience / Persona**: Players and hosts opening `unodz.vercel.app` (or any Vercel preview/production URL) expecting instant guest token issuance, room creation, and responsive gameplay.
- **Key Value**: Zero-configuration deployment on Vercel while maintaining 100% compatibility with dedicated Socket.IO servers (`server.ts`, Docker, Fly.io, Railway).

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Instant Session Issuance**: Opening `unodz.vercel.app` immediately issues a guest token from `POST /api/session/guest` on the same origin and transitions the status indicator to `Realtime Ready`.
  2. **Create & Join Room on Vercel**: Clicking **Create Room** dispatches `room:create`. If native WebSockets are unavailable on Vercel Serverless, the transport transparently routes through `POST /api/rpc`, creates the 4-letter room, and enters the Room Lobby.
  3. **Full Gameplay & Companion Bots**: Adding AI/companion seats, toggling house rules, starting the match, playing cards, calling UNO, and viewing leaderboards all work identically with rich Web Audio sound FX and major milestone announcer callouts.
- **Visual Identity & Theme**:
  - Preserves the 60-30-10 emerald felt (`#0B2B26`), dark slate HUD (`#0F172A`), crisp white card faces, and unboxed inline metadata ticker in the center arena.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Same-Origin API Resolution**:
  - *Chosen Approach*: Use `process.env.NEXT_PUBLIC_SOCKET_URL || window.location.origin` with zero hardcoded third-party URLs.
  - *Why*: Eliminates cross-origin failures and dead container links when deploying to Vercel or custom domains.
- **Decision 2: Dual-Transport Client with Serverless State Continuity**:
  - *Chosen Approach*: Attempt native Socket.IO first on local/custom socket hosts, and automatically switch to `/api/rpc` HTTP transport on Vercel (`.vercel.app`) or on Socket.IO `connect_error`. Include an HMAC-signed room state envelope so stateless serverless lambdas can recover room state even without Redis.
  - *Why*: Vercel Serverless Functions do not support persistent WebSocket connections or sticky in-memory state across lambdas; hybrid `/api/rpc` + signed state continuity makes standalone Vercel deployments rock-solid.

---

## 4. Technical Architecture & Data Strategy

```
┌──────────────────────────────────────────────────────────────────────┐
│                   CardClash Client (Browser / PWA)                   │
├──────────────────────────────────────────────────────────────────────┤
│  1. Session Auth: POST /api/session/guest (Same-Origin on Vercel)    │
│  2. Realtime Transport Adapter:                                      │
│     ├──► [Socket.IO Available] ──► Native WebSocket (server.ts)      │
│     └──► [Vercel Serverless]   ──► HTTP RPC + Poll (POST /api/rpc)   │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│              Next.js App Router API (/api/rpc/route.ts)              │
├──────────────────────────────────────────────────────────────────────┤
│  • Verifies HMAC Session Token                                       │
│  • Executes Authoritative RoomManager & @cardclash/engine            │
│  • Executes Server Bot Turns & Turn Timeouts                         │
│  • Persists to Redis / Global Memory + HMAC Continuity Envelope      │
└──────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & State Mapping
- **Client Transport Adapter**: Implements the `Socket`-compatible interface (`on`, `emit`, `disconnect`, `connected`) so `CardClashApp` requires zero UI changes and all existing Socket.IO event listeners (`ROOM_STATE`, `GAME_VIEW`, `GAME_EVENTS`, `CHAT_HISTORY`, `CHAT_MESSAGE`, `REACTION_BURST`, `ERROR_EVENT`) work identically across both transports.
- **Serverless RPC Handler**: Processes all client intents through the exact same `RoomManager` and `@cardclash/engine` reducer used by `createCardClashServer`, ensuring 100% rule parity and security.

# CardClash

Real-time multiplayer UNO-style shedding card game built with an authoritative deterministic TypeScript engine and original colorblind-safe vector card art.

## Architecture & Phases (`SPEC.md`)

- **Phase 1 (Complete)**: `SPEC.md` + `packages/engine` (`@cardclash/engine`) — pure TypeScript game logic, 108-card deck factory, seeded Fisher-Yates PRNG (`xoshiro128**`), `createGame`, `reduce(state, action)`, `getPlayerView(state, playerId)`, house rules (`stacking`, `sevenZeroSwap`, `jumpIn`, `wildDrawFourChallenge`), unit tests, and `fast-check` property-based tests.
- **Phase 2 (Complete)**: `packages/protocol` (`@cardclash/protocol`), `apps/server` (`@cardclash/server`), and `docs/PROTOCOL.md` — shared Socket.IO event constants and Zod schemas, HMAC-SHA256 signed session token handshake authentication, 4-letter room creation/join/leave/ready/start, engine action execution with cryptographic 32-byte seed (`crypto.randomBytes(32)`) and ordered match action log, per-player `getPlayerView` broadcasting, monotonic `seq` checks, Redis (`ioredis`) snapshot persistence after every action with automatic in-memory fallback, and per-socket sliding-window rate limiting.
- **Phase 3 (Complete)**: `apps/web` + root Next.js App Router mobile-first UI (`360px` up to `1440px` desktop) — Home, Room Lobby, and Interactive Card Table (`components/cardclash-app.tsx`, `components/card-table-view.tsx`, `components/card-graphic.tsx`, `components/table-modals.tsx`). Includes fanned hand, draw/discard piles, clockwise/counter-clockwise turn & direction indicator, 4-quadrant wild color picker, `UNO!` + `Catch!` buttons, `7-0` swap & `+4` bluff challenge modals, event toasts, Web Audio synthesized sound effects, companion seat testing bar, and original colorblind-safe CSS/SVG card artwork (`▲` Crimson, `◆` Cobalt, `●` Amber, `★` Emerald, `✦` Wild).
- **Phase 4 (Complete)**: Resilience — automatic seat & view recovery on signed token reconnect, 60-second disconnect grace timer followed by authoritative server-side bot seat takeover (`apps/server/src/bot.ts`), 30-second server-side turn timer (auto draw/pass with live HUD countdown), periodic `session:heartbeat` presence sync, and `room:rematch` flow.
- **Phase 5 (Complete)**: Accounts, Auth.js-compatible web-issued session tokens (`POST /api/auth/session` with guests staying default), Drizzle ORM PostgreSQL schema (`apps/server/src/db/schema.ts`) with automatic `InMemoryAccountRepository` fallback when `DATABASE_URL` is unset, automatic match history persistence from `MatchActionLog`, multi-player OpenSkill Bayesian ratings (`apps/server/src/openskill.ts`), and live Leaderboard & Match History UI (`components/leaderboard-section.tsx`).
- **Phase 6 (Complete)**: Scale & Polish — deterministic match replay viewer with interactive scrubber slider, turn playback speed controls (0.5x to 4x), live spectator mode with presence tracking and hand masking, moderated real-time in-game chat and floating emoji reaction bursts (`components/in-game-chat.tsx`), Artillery bot load test (`tests/artillery/cardclash-load-test.yml`), TypeScript 1,000-room concurrency benchmark (`apps/server/tests/load-test-benchmark.ts`), multi-stage production `Dockerfile` and `docker-compose.yml`, cloud deployment guide (`docs/DEPLOYMENT.md`), and full PWA compliance (`app/manifest.ts`, in-app install prompt `PWAInstallButton`, and `OfflineIndicator`).

## Commands

```bash
# Run strict TypeScript typechecking across root, engine, protocol, and server
npm run typecheck

# Run Vitest unit, property, UI helper, server resilience, account/rating, and Phase 6 tests
npm test

# Run the 1,000 concurrent rooms load benchmark
npx tsx apps/server/tests/load-test-benchmark.ts

# Start the full-stack development server on port 3000
npm run dev
```

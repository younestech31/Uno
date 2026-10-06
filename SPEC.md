# CardClash — Specification (SPEC.md)

ROLE: Senior full-stack engineer. Build "CardClash", a real-time multiplayer UNO-style game. Use an original name and original card art (CSS/SVG). No Mattel logos or assets.

FIRST: Save this whole brief as SPEC.md in the repo root and re-read it at the start of every phase. Work ONE phase at a time. After each: run typecheck and tests, summarize what works and how to run it, then STOP until I say "next".

## STACK
- pnpm monorepo, TypeScript strict, no any types
- apps/web: Next.js App Router, Tailwind, framer-motion. Stateless, no game logic.
- apps/server: Node + Socket.IO. Owns all live game state. Separate deployable.
- packages/engine: pure TS game logic, no Node/browser APIs
- packages/protocol: shared socket event names + Zod schemas
- Redis (ioredis): snapshots, room-code lookup, presence. In-memory fallback if REDIS_URL is unset.
- Postgres + Drizzle: accounts, match history, ratings (Phase 5)
- Vitest + fast-check for tests

## NON-NEGOTIABLE RULES
1. Server is authoritative. Clients send intents only (e.g. play card X, color Y). Server checks turn, card ownership, legality, color.
2. Engine is pure: reduce(state, action) returns {state, events} or a typed error. No I/O, Date.now() or Math.random() inside.
3. Shuffle = Fisher-Yates with a seeded PRNG; seed from crypto.randomBytes(32) on the server. Log seed + ordered actions per match. Never send the seed to clients until the match ends.
4. Clients get getPlayerView(state, playerId): own hand in full, opponents' card counts only, never deck order. Client may import small helpers (e.g. isPlayable) for UI hints only.
5. Every client action has an increasing seq; reject stale or duplicate ones.
6. Identity = signed session token sent in the socket handshake auth, never socket.id.
7. All state is room-scoped so rooms can be sharded later. Run single-node first.
8. No secrets in client code. Provide .env.example.

## GAME RULES (implement exactly; ask me instead of inventing)
- Standard 108-card deck, 7 cards each, 2-4 players first (config supports up to 10 later)
- First card: Wild Draw Four = reshuffle and reflip; Wild = first player picks color; Skip/Draw Two hit the first player; Reverse flips direction
- Play matches color, number or symbol; Wild always legal; Wild Draw Four only if hand has no card of the current color
- Reverse acts as Skip with 2 players
- Can't play: draw 1; may play it if legal, else pass
- At 1 card you must call UNO; anyone can catch you before the next player acts; caught = draw 2
- Deck empty: reshuffle discard pile, keep top card
- Round winner scores opponents' hands (numbers face value, Skip/Reverse/Draw Two 20, Wild/+4 50). Match target 500, configurable.
- House-rule flags, default OFF: stacking +2/+4, 7-0 swap, jump-in, +4 challenge (+4 playable anytime; wrong challenger draws 6, caught bluffer draws 4)

## PHASES
1. Scaffold + packages/engine: types, createGame, reduce, getPlayerView, seeded shuffle. Tests for every card rule plus property tests (108 cards always conserved, valid turn order, views never leak hands). No UI.
2. apps/server: create room (4-letter code), join, leave, ready, start; run actions through engine; broadcast per-player views; seq checks; Redis snapshot after every action; per-socket rate limit; document events in docs/PROTOCOL.md.
3. apps/web, mobile-first (360px up): home, lobby, table. Fanned hand, draw/discard piles, turn indicator, wild color picker, UNO + Catch buttons, event toasts, animations, colorblind-safe cards (symbol + color).
4. Resilience: reconnect via token, 60s grace, then a simple bot takes the seat; 30s server-side turn timer (auto draw/pass); heartbeats; rematch.
5. Accounts: guests stay default; optional Auth.js login (web issues the token, server verifies it); match history from the action log; OpenSkill ratings; leaderboard.
6. Scale + polish: replay viewer, spectators, moderated chat (filter, report, rate limit), Artillery bot load test (goal: 1,000 concurrent rooms on one node), Dockerfile + docker-compose (server, redis, postgres), deploy notes (web on Vercel, server on Fly.io or Railway), PWA.

## QUALITY
- Small files, clear folders, README with run/test/deploy steps
- Ask before adding dependencies not listed above
- If something is ambiguous, ask ONE question and wait

## CLARIFIED DECISIONS
- Scope Execution: Phase-by-phase starting strictly with `SPEC.md` and Phase 1 (`packages/engine` + Vitest & fast-check tests).
- UNO Call Semantics: Separate `CALL_UNO` action window until the next player acts (also allowing pre-calling UNO when holding 2 cards before playing down to 1 card). Any opponent can dispatch `CATCH_UNO` while the player is vulnerable on 1 card before the next player acts.
- Monorepo Structure: Workspace packages (`packages/engine`, `packages/protocol`, `apps/server`, `apps/web`) maintained with unified port 3000 preview compatibility.

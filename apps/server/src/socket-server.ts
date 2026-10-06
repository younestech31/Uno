import http from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  ChatReportIntentSchema,
  ChatSendIntentSchema,
  ClientGameActionIntentSchema,
  GameActionEnvelopeSchema,
  RoomCreateIntentSchema,
  RoomJoinIntentSchema,
  RoomLeaveIntentSchema,
  RoomReadyIntentSchema,
  RoomRematchIntentSchema,
  RoomSpectateIntentSchema,
  RoomStartIntentSchema,
  SOCKET_EVENTS,
  SessionHeartbeatIntentSchema,
  type ChatMessagePayload,
  type ClientGameActionIntent,
  type GameEventsBroadcast,
  type GameViewBroadcast,
  type HeartbeatAckPayload,
  type ProtocolErrorPayload,
  type PublicRoomState,
  type ReplayDataBundle,
  type SocketAckResult,
} from '@cardclash/protocol';
import {
  getSharedAccountRepository,
  type AccountRepository,
} from './account-repo';
import {
  signSessionToken,
  verifySessionToken,
  type SessionIdentity,
} from './auth';
import { computeBotActionIntent, computeTurnTimeoutIntent } from './bot';
import { ChatModerationManager } from './chat-moderation';
import { SocketRateLimiter, type RateLimiterOptions } from './rate-limit';
import { RoomManager, type StartOrActionSuccess } from './room-manager';
import { createStateStore, type StateStore } from './store';

interface SocketData {
  identity: SessionIdentity;
  rateLimitKey: string;
}

export interface CardClashServerOptions {
  readonly httpServer?: http.Server;
  readonly store?: StateStore;
  readonly accountRepo?: AccountRepository;
  readonly chatModerator?: ChatModerationManager;
  readonly sessionSecret?: string;
  readonly rateLimit?: Partial<RateLimiterOptions>;
  readonly corsOrigin?: string | string[];
  readonly turnTimeoutMs?: number;
  readonly disconnectGraceMs?: number;
  readonly botActionDelayMs?: number;
}

export interface CardClashServerInstance {
  readonly io: SocketIOServer;
  readonly httpServer: http.Server;
  readonly store: StateStore;
  readonly accountRepo: AccountRepository;
  readonly roomManager: RoomManager;
  readonly chatModerator: ChatModerationManager;
  readonly rateLimiter: SocketRateLimiter;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

function sendError<T>(
  socket: Socket,
  ack: ((res: SocketAckResult<T>) => void) | undefined,
  error: ProtocolErrorPayload
): void {
  socket.emit(SOCKET_EVENTS.ERROR_EVENT, error);
  if (typeof ack === 'function') {
    ack({ ok: false, error });
  }
}

function playerChannel(playerId: string): string {
  return `player:${playerId}`;
}

function roomChannel(roomCode: string): string {
  return `room:${roomCode.toUpperCase()}`;
}

function spectatorChannel(roomCode: string): string {
  return `spectators:${roomCode.toUpperCase()}`;
}

/**
 * Creates an authoritative CardClash Socket.IO server instance.
 * Enforces signed session token handshake auth (Rule 6), per-socket rate limiting,
 * Zod intent validation, engine reduction, per-player views, post-action snapshots,
 * token auto-reconnect, 60s grace -> bot takeover, 30s turn timers, heartbeats, rematch,
 * OpenSkill rating persistence, live spectators, in-game chat moderation, and replay data.
 */
export function createCardClashServer(
  options?: CardClashServerOptions
): CardClashServerInstance {
  const store = options?.store ?? createStateStore();
  const ownedAccountRepo = Boolean(options?.accountRepo);
  const accountRepo = options?.accountRepo ?? getSharedAccountRepository();
  const roomManager = new RoomManager(store, accountRepo);
  const chatModerator =
    options?.chatModerator ?? new ChatModerationManager(options?.rateLimit);
  const rateLimiter = new SocketRateLimiter(options?.rateLimit);

  const turnTimeoutMs = options?.turnTimeoutMs ?? 30_000;
  const disconnectGraceMs = options?.disconnectGraceMs ?? 60_000;
  const botActionDelayMs = options?.botActionDelayMs ?? 120;

  const turnTimersByRoom = new Map<string, ReturnType<typeof setTimeout>>();
  const botTimersByRoom = new Map<string, ReturnType<typeof setTimeout>>();
  const graceTimersByPlayer = new Map<string, ReturnType<typeof setTimeout>>();
  let isClosing = false;

  const clearRoomTimers = (roomCode: string): void => {
    const code = roomCode.toUpperCase();
    const tTimer = turnTimersByRoom.get(code);
    if (tTimer) {
      clearTimeout(tTimer);
      turnTimersByRoom.delete(code);
    }
    const bTimer = botTimersByRoom.get(code);
    if (bTimer) {
      clearTimeout(bTimer);
      botTimersByRoom.delete(code);
    }
  };

  const clearGraceTimer = (playerId: string): void => {
    const gTimer = graceTimersByPlayer.get(playerId);
    if (gTimer) {
      clearTimeout(gTimer);
      graceTimersByPlayer.delete(playerId);
    }
  };

  const ownedHttpServer = !options?.httpServer;
  const httpServer =
    options?.httpServer ??
    http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            store: store.backend,
            accountStore: accountRepo.backend,
          })
        );
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/api/leaderboard')) {
        void (async () => {
          try {
            const [leaderboard, recentMatches] = await Promise.all([
              accountRepo.getLeaderboard(20),
              accountRepo.getRecentMatches(15),
            ]);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ leaderboard, recentMatches }));
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to load leaderboard' }));
          }
        })();
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/api/matches/')) {
        const parts = req.url.split('/');
        const matchId = parts[3]?.split('?')[0];
        if (matchId) {
          void (async () => {
            try {
              const replayData = await roomManager.getReplayData(matchId);
              if (!replayData) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Match replay not found' }));
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(replayData));
            } catch {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Failed to load replay' }));
            }
          })();
          return;
        }
      }

      if (req.method === 'POST' && req.url === '/api/session/guest') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        req.on('end', () => {
          void (async () => {
            try {
              const parsed = (body ? JSON.parse(body) : {}) as {
                name?: string;
                playerId?: string;
              };
              const name =
                typeof parsed.name === 'string' && parsed.name.trim().length > 0
                  ? parsed.name.trim().slice(0, 24)
                  : 'Guest Player';
              const playerId =
                typeof parsed.playerId === 'string' &&
                parsed.playerId.trim().length > 0
                  ? parsed.playerId.trim()
                  : `usr_${Math.random().toString(36).slice(2, 10)}`;
              const profile = await accountRepo.upsertAccount({
                playerId,
                name,
                email: null,
                isGuest: true,
              });
              const token = signSessionToken(
                { playerId, name, email: null, isGuest: true },
                options?.sessionSecret
              );
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  token,
                  playerId,
                  name,
                  email: null,
                  isGuest: true,
                  profile,
                })
              );
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid request body' }));
            }
          })();
        });
        return;
      }

      if (req.method === 'POST' && req.url === '/api/auth/session') {
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        req.on('end', () => {
          void (async () => {
            try {
              const parsed = (body ? JSON.parse(body) : {}) as {
                email?: string;
                name?: string;
                playerId?: string;
              };
              const rawEmail =
                typeof parsed.email === 'string'
                  ? parsed.email.trim().toLowerCase()
                  : '';
              if (!rawEmail || !rawEmail.includes('@')) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({ error: 'Valid email is required for sign-in' })
                );
                return;
              }
              const existingByEmail =
                await accountRepo.findAccountByEmail(rawEmail);
              const playerId =
                existingByEmail?.playerId ??
                (typeof parsed.playerId === 'string' &&
                parsed.playerId.trim().length > 0
                  ? parsed.playerId.trim()
                  : `acc_${Math.random().toString(36).slice(2, 10)}`);
              const name =
                typeof parsed.name === 'string' && parsed.name.trim().length > 0
                  ? parsed.name.trim().slice(0, 24)
                  : existingByEmail?.name ?? rawEmail.split('@')[0]!.slice(0, 24);

              const profile = await accountRepo.upsertAccount({
                playerId,
                name,
                email: rawEmail,
                isGuest: false,
              });
              const token = signSessionToken(
                { playerId, name: profile.name, email: rawEmail, isGuest: false },
                options?.sessionSecret
              );
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  token,
                  playerId: profile.playerId,
                  name: profile.name,
                  email: profile.email,
                  isGuest: false,
                  profile,
                })
              );
            } catch {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid auth request' }));
            }
          })();
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: options?.corsOrigin ?? '*',
      methods: ['GET', 'POST'],
    },
  });

  const broadcastActionSuccess = (
    actorPlayerId: string,
    seq: number,
    data: StartOrActionSuccess,
    alwaysEmitRoomState = false
  ): void => {
    const { room, matchId, events, viewsByPlayer, spectatorView } = data;
    if (alwaysEmitRoomState || room.status === 'FINISHED') {
      io.to(roomChannel(room.roomCode)).emit(SOCKET_EVENTS.ROOM_STATE, room);
    }

    const eventsPayload: GameEventsBroadcast = {
      roomCode: room.roomCode,
      matchId,
      actorPlayerId,
      seq,
      events,
    };
    io.to(roomChannel(room.roomCode)).emit(
      SOCKET_EVENTS.GAME_EVENTS,
      eventsPayload
    );

    for (const [pid, view] of Object.entries(viewsByPlayer)) {
      const viewPayload: GameViewBroadcast = {
        roomCode: room.roomCode,
        view,
        turnDeadlineAt: room.turnDeadlineAt ?? null,
      };
      io.to(playerChannel(pid)).emit(SOCKET_EVENTS.GAME_VIEW, viewPayload);
    }

    if (spectatorView) {
      const spectatorPayload: GameViewBroadcast = {
        roomCode: room.roomCode,
        view: spectatorView,
        turnDeadlineAt: room.turnDeadlineAt ?? null,
        isSpectator: true,
      };
      io.to(spectatorChannel(room.roomCode)).emit(
        SOCKET_EVENTS.GAME_VIEW,
        spectatorPayload
      );
    }
  };

  const scheduleRoomLifecycleTimers = async (roomCode: string): Promise<void> => {
    if (isClosing) return;
    const code = roomCode.toUpperCase();
    clearRoomTimers(code);

    const snapshot = await store.getRoomSnapshot(code);
    if (
      !snapshot ||
      snapshot.status !== 'IN_GAME' ||
      !snapshot.gameState ||
      snapshot.gameState.status !== 'IN_PROGRESS'
    ) {
      return;
    }

    const activeEnginePlayer =
      snapshot.gameState.players[snapshot.gameState.currentPlayerIndex];
    if (!activeEnginePlayer) return;

    const roomMember = snapshot.players.find(
      (p) => p.id === activeEnginePlayer.id
    );

    // 1. If the active player is a server-controlled bot, schedule an automatic bot action
    if (roomMember?.isBot) {
      const bTimer = setTimeout(async () => {
        if (isClosing) return;
        const latest = await store.getRoomSnapshot(code);
        if (
          !latest ||
          !latest.gameState ||
          latest.gameState.status !== 'IN_PROGRESS'
        ) {
          return;
        }
        const currentEnginePlayer =
          latest.gameState.players[latest.gameState.currentPlayerIndex];
        if (
          !currentEnginePlayer ||
          currentEnginePlayer.id !== activeEnginePlayer.id
        ) {
          return;
        }

        const botIntent = computeBotActionIntent(
          latest.gameState,
          currentEnginePlayer.id
        );
        if (!botIntent) return;

        const res = await roomManager.handleGameAction(
          currentEnginePlayer.id,
          botIntent,
          code,
          turnTimeoutMs
        );
        if (res.ok) {
          broadcastActionSuccess(
            currentEnginePlayer.id,
            botIntent.seq,
            res.data
          );
          await scheduleRoomLifecycleTimers(code);
        }
      }, botActionDelayMs);

      botTimersByRoom.set(code, bTimer);
    }

    // 2. Schedule the 30s server-side turn timer (auto draw / pass)
    const tTimer = setTimeout(async () => {
      if (isClosing) return;
      const latest = await store.getRoomSnapshot(code);
      if (
        !latest ||
        !latest.gameState ||
        latest.gameState.status !== 'IN_PROGRESS'
      ) {
        return;
      }

      const timeoutMove = computeTurnTimeoutIntent(latest.gameState);
      if (!timeoutMove) return;

      const step1 = await roomManager.handleGameAction(
        timeoutMove.playerId,
        timeoutMove.intent,
        code,
        turnTimeoutMs
      );
      if (!step1.ok) return;

      broadcastActionSuccess(
        timeoutMove.playerId,
        timeoutMove.intent.seq,
        step1.data
      );

      // If auto DRAW_CARD entered DRAWN_PLAY_OR_PASS, immediately auto PASS_TURN so the turn advances
      const postStepState = step1.data.snapshot.gameState;
      if (
        postStepState &&
        postStepState.status === 'IN_PROGRESS' &&
        postStepState.turnPhase === 'DRAWN_PLAY_OR_PASS' &&
        postStepState.players[postStepState.currentPlayerIndex]?.id ===
          timeoutMove.playerId
      ) {
        const passSeq =
          (postStepState.lastSeqByPlayer[timeoutMove.playerId] ?? 0) + 1;
        const passIntent: ClientGameActionIntent = {
          type: 'PASS_TURN',
          seq: passSeq,
        };
        const step2 = await roomManager.handleGameAction(
          timeoutMove.playerId,
          passIntent,
          code,
          turnTimeoutMs
        );
        if (step2.ok) {
          broadcastActionSuccess(timeoutMove.playerId, passSeq, step2.data);
        }
      }

      await scheduleRoomLifecycleTimers(code);
    }, turnTimeoutMs);

    turnTimersByRoom.set(code, tTimer);
  };

  let connectionCounter = 0;

  // Handshake Authentication Middleware:
  // Rule 6: Identity = signed session token sent in the socket handshake auth, never socket.id.
  io.use((socket, next) => {
    const rawToken: unknown = socket.handshake.auth?.token;
    const identity = verifySessionToken(rawToken, options?.sessionSecret);
    if (!identity) {
      const authErr = new Error('UNAUTHORIZED: Invalid or missing session token');
      next(authErr);
      return;
    }

    connectionCounter += 1;
    const data = socket.data as SocketData;
    data.identity = identity;
    data.rateLimitKey = `${identity.playerId}:${connectionCounter}`;
    next();
  });

  io.on('connection', async (socket) => {
    const { identity, rateLimitKey } = socket.data as SocketData;

    // Cancel any pending 60s disconnect grace timer for this player
    clearGraceTimer(identity.playerId);

    // Bind socket to the authenticated player's personal channel
    await socket.join(playerChannel(identity.playerId));

    // Automatically restore room & game view if player is reconnecting via token
    const reconnected = await roomManager.reconnectPlayer(identity);
    if (reconnected) {
      await socket.join(roomChannel(reconnected.roomCode));
      const snap = await store.getRoomSnapshot(reconnected.roomCode);
      const isSpectator = (snap?.spectators ?? []).some(
        (s) => s.id === identity.playerId
      );
      if (isSpectator) {
        await socket.join(spectatorChannel(reconnected.roomCode));
      }

      io.to(roomChannel(reconnected.roomCode)).emit(
        SOCKET_EVENTS.ROOM_STATE,
        reconnected.room
      );
      if (reconnected.view) {
        const viewPayload: GameViewBroadcast = {
          roomCode: reconnected.roomCode,
          view: reconnected.view,
          turnDeadlineAt: reconnected.turnDeadlineAt,
          isSpectator,
        };
        io.to(playerChannel(identity.playerId)).emit(
          SOCKET_EVENTS.GAME_VIEW,
          viewPayload
        );
      }
    } else {
      await store.setPresence({
        playerId: identity.playerId,
        name: identity.name,
        roomCode: null,
        connected: true,
        updatedAt: Date.now(),
      });
    }

    const checkRateLimit = <T>(
      ack?: (res: SocketAckResult<T>) => void
    ): boolean => {
      if (!rateLimiter.consume(rateLimitKey)) {
        sendError(socket, ack, {
          code: 'RATE_LIMITED',
          message: 'Too many requests; please slow down',
        });
        return false;
      }
      return true;
    };

    // 0. session:heartbeat
    socket.on(
      SOCKET_EVENTS.SESSION_HEARTBEAT,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<HeartbeatAckPayload>) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const parsed = SessionHeartbeatIntentSchema.safeParse(
          rawPayload ?? undefined
        );
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message: 'Invalid session:heartbeat payload',
          });
          return;
        }

        const now = Date.now();
        const currentRoomCode = await store.getPlayerRoom(identity.playerId);
        await store.setPresence({
          playerId: identity.playerId,
          name: identity.name,
          roomCode: currentRoomCode,
          connected: true,
          updatedAt: now,
        });

        let turnDeadlineAt: number | null = null;
        if (currentRoomCode) {
          const snap = await store.getRoomSnapshot(currentRoomCode);
          turnDeadlineAt = snap?.turnDeadlineAt ?? null;
        }

        if (typeof ack === 'function') {
          ack({
            ok: true,
            data: {
              serverTime: now,
              roomCode: currentRoomCode,
              turnDeadlineAt,
            },
          });
        }
      }
    );

    // 1. room:create
    socket.on(
      SOCKET_EVENTS.ROOM_CREATE,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<{ room: PublicRoomState }>) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const parsed = RoomCreateIntentSchema.safeParse(rawPayload ?? undefined);
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid room:create payload',
          });
          return;
        }

        const result = await roomManager.createRoom(identity, parsed.data);
        if (!result.ok) {
          sendError(socket, ack, result.error);
          return;
        }

        const { room } = result.data;
        await socket.join(roomChannel(room.roomCode));
        io.to(roomChannel(room.roomCode)).emit(SOCKET_EVENTS.ROOM_STATE, room);

        if (typeof ack === 'function') {
          ack({ ok: true, data: { room } });
        }
      }
    );

    // 2. room:join
    socket.on(
      SOCKET_EVENTS.ROOM_JOIN,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<{ room: PublicRoomState }>) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const parsed = RoomJoinIntentSchema.safeParse(rawPayload);
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid room:join payload',
          });
          return;
        }

        const result = await roomManager.joinRoom(
          identity,
          parsed.data.roomCode
        );
        if (!result.ok) {
          sendError(socket, ack, result.error);
          return;
        }

        clearGraceTimer(identity.playerId);

        const { room, view, turnDeadlineAt } = result.data;
        await socket.join(roomChannel(room.roomCode));
        io.to(roomChannel(room.roomCode)).emit(SOCKET_EVENTS.ROOM_STATE, room);

        if (view) {
          const viewPayload: GameViewBroadcast = {
            roomCode: room.roomCode,
            view,
            turnDeadlineAt,
          };
          io.to(playerChannel(identity.playerId)).emit(
            SOCKET_EVENTS.GAME_VIEW,
            viewPayload
          );
        }

        if (typeof ack === 'function') {
          ack({ ok: true, data: { room } });
        }
      }
    );

    // 2b. room:spectate
    socket.on(
      SOCKET_EVENTS.ROOM_SPECTATE,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<{ room: PublicRoomState }>) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const parsed = RoomSpectateIntentSchema.safeParse(rawPayload);
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid room:spectate payload',
          });
          return;
        }

        const result = await roomManager.spectateRoom(
          identity,
          parsed.data.roomCode
        );
        if (!result.ok) {
          sendError(socket, ack, result.error);
          return;
        }

        const { room, view, turnDeadlineAt } = result.data;
        await socket.join(roomChannel(room.roomCode));
        await socket.join(spectatorChannel(room.roomCode));
        io.to(roomChannel(room.roomCode)).emit(SOCKET_EVENTS.ROOM_STATE, room);

        if (view) {
          const viewPayload: GameViewBroadcast = {
            roomCode: room.roomCode,
            view,
            turnDeadlineAt,
            isSpectator: true,
          };
          io.to(playerChannel(identity.playerId)).emit(
            SOCKET_EVENTS.GAME_VIEW,
            viewPayload
          );
        }

        if (typeof ack === 'function') {
          ack({ ok: true, data: { room } });
        }
      }
    );

    // 3. room:leave
    socket.on(
      SOCKET_EVENTS.ROOM_LEAVE,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<{ roomCode: string }>) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const parsed = RoomLeaveIntentSchema.safeParse(rawPayload ?? undefined);
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid room:leave payload',
          });
          return;
        }

        const result = await roomManager.leaveRoom(
          identity.playerId,
          parsed.data?.roomCode
        );
        if (!result.ok) {
          sendError(socket, ack, result.error);
          return;
        }

        const { roomCode, room } = result.data;
        await socket.leave(roomChannel(roomCode));
        await socket.leave(spectatorChannel(roomCode));
        if (!room) {
          clearRoomTimers(roomCode);
        } else {
          io.to(roomChannel(roomCode)).emit(SOCKET_EVENTS.ROOM_STATE, room);
        }

        if (typeof ack === 'function') {
          ack({ ok: true, data: { roomCode } });
        }
      }
    );

    // 4. room:ready
    socket.on(
      SOCKET_EVENTS.ROOM_READY,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<{ room: PublicRoomState }>) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const parsed = RoomReadyIntentSchema.safeParse(rawPayload);
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid room:ready payload',
          });
          return;
        }

        const result = await roomManager.setReady(
          identity.playerId,
          parsed.data.ready,
          parsed.data.roomCode
        );
        if (!result.ok) {
          sendError(socket, ack, result.error);
          return;
        }

        const { room } = result.data;
        io.to(roomChannel(room.roomCode)).emit(SOCKET_EVENTS.ROOM_STATE, room);

        if (typeof ack === 'function') {
          ack({ ok: true, data: { room } });
        }
      }
    );

    // 5. room:start
    socket.on(
      SOCKET_EVENTS.ROOM_START,
      async (
        rawPayload: unknown,
        ack?: (
          res: SocketAckResult<{ room: PublicRoomState; matchId: string }>
        ) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const parsed = RoomStartIntentSchema.safeParse(rawPayload ?? undefined);
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid room:start payload',
          });
          return;
        }

        const result = await roomManager.startRoom(
          identity.playerId,
          parsed.data?.roomCode,
          turnTimeoutMs
        );
        if (!result.ok) {
          sendError(socket, ack, result.error);
          return;
        }

        const { room, matchId } = result.data;
        broadcastActionSuccess(identity.playerId, 0, result.data, true);
        await scheduleRoomLifecycleTimers(room.roomCode);

        if (typeof ack === 'function') {
          ack({ ok: true, data: { room, matchId } });
        }
      }
    );

    // 6. room:rematch
    socket.on(
      SOCKET_EVENTS.ROOM_REMATCH,
      async (
        rawPayload: unknown,
        ack?: (
          res: SocketAckResult<{ room: PublicRoomState; matchId: string }>
        ) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const parsed = RoomRematchIntentSchema.safeParse(
          rawPayload ?? undefined
        );
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid room:rematch payload',
          });
          return;
        }

        const result = await roomManager.rematch(
          identity.playerId,
          parsed.data?.roomCode,
          turnTimeoutMs
        );
        if (!result.ok) {
          sendError(socket, ack, result.error);
          return;
        }

        const { room, matchId } = result.data;
        broadcastActionSuccess(identity.playerId, 0, result.data, true);
        await scheduleRoomLifecycleTimers(room.roomCode);

        if (typeof ack === 'function') {
          ack({ ok: true, data: { room, matchId } });
        }
      }
    );

    // 7. game:action
    socket.on(
      SOCKET_EVENTS.GAME_ACTION,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<{ matchId: string; seq: number }>) => void
      ) => {
        if (!checkRateLimit(ack)) return;

        const envelopeParsed = GameActionEnvelopeSchema.safeParse(rawPayload);
        let roomCode: string | undefined;
        let actionIntent: ClientGameActionIntent;

        if (envelopeParsed.success) {
          roomCode = envelopeParsed.data.roomCode;
          actionIntent = envelopeParsed.data.action;
        } else {
          const directParsed =
            ClientGameActionIntentSchema.safeParse(rawPayload);
          if (!directParsed.success) {
            const issueMessage =
              envelopeParsed.error.issues[0]?.message ??
              'Invalid game:action payload';
            sendError(socket, ack, {
              code: 'VALIDATION_ERROR',
              message: issueMessage,
            });
            return;
          }
          actionIntent = directParsed.data;
        }

        const result = await roomManager.handleGameAction(
          identity.playerId,
          actionIntent,
          roomCode,
          turnTimeoutMs
        );
        if (!result.ok) {
          sendError(socket, ack, result.error);
          return;
        }

        const { room, matchId } = result.data;
        broadcastActionSuccess(
          identity.playerId,
          actionIntent.seq,
          result.data,
          false
        );
        await scheduleRoomLifecycleTimers(room.roomCode);

        if (typeof ack === 'function') {
          ack({ ok: true, data: { matchId, seq: actionIntent.seq } });
        }
      }
    );

    // 8. chat:send
    socket.on(
      SOCKET_EVENTS.CHAT_SEND,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<{ message: ChatMessagePayload }>) => void
      ) => {
        const parsed = ChatSendIntentSchema.safeParse(rawPayload);
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid chat:send payload',
          });
          return;
        }

        const targetRoomCode =
          parsed.data.roomCode?.toUpperCase() ??
          (await store.getPlayerRoom(identity.playerId)) ??
          '';

        if (!targetRoomCode) {
          sendError(socket, ack, {
            code: 'NOT_IN_ROOM',
            message: 'You must be in or spectating a room to send chat',
          });
          return;
        }

        const snap = await store.getRoomSnapshot(targetRoomCode);
        const isSpectator = (snap?.spectators ?? []).some(
          (s) => s.id === identity.playerId
        );

        const modResult = chatModerator.createMessage({
          roomCode: targetRoomCode,
          senderId: identity.playerId,
          senderName: identity.name,
          isSpectator,
          rawText: parsed.data.text ?? null,
          emoji: parsed.data.emoji ?? null,
        });

        if (!modResult.ok) {
          sendError(socket, ack, {
            code: modResult.code,
            message: modResult.error,
          });
          return;
        }

        io.to(roomChannel(targetRoomCode)).emit(
          SOCKET_EVENTS.CHAT_MESSAGE,
          modResult.message
        );

        if (typeof ack === 'function') {
          ack({ ok: true, data: { message: modResult.message } });
        }
      }
    );

    // 9. chat:report
    socket.on(
      SOCKET_EVENTS.CHAT_REPORT,
      async (
        rawPayload: unknown,
        ack?: (res: SocketAckResult<{ reported: boolean }>) => void
      ) => {
        const parsed = ChatReportIntentSchema.safeParse(rawPayload);
        if (!parsed.success) {
          sendError(socket, ack, {
            code: 'VALIDATION_ERROR',
            message:
              parsed.error.issues[0]?.message ?? 'Invalid chat:report payload',
          });
          return;
        }

        const targetRoomCode =
          parsed.data.roomCode?.toUpperCase() ??
          (await store.getPlayerRoom(identity.playerId)) ??
          '';

        const rep = chatModerator.reportMessage({
          roomCode: targetRoomCode,
          messageId: parsed.data.messageId,
          reporterId: identity.playerId,
          reason: parsed.data.reason,
        });

        if (!rep) {
          sendError(socket, ack, {
            code: 'MESSAGE_NOT_FOUND',
            message: 'Target message was not found to report',
          });
          return;
        }

        if (typeof ack === 'function') {
          ack({ ok: true, data: { reported: true } });
        }
      }
    );

    socket.on('disconnect', async () => {
      rateLimiter.remove(rateLimitKey);
      if (isClosing) return;

      // Check if player still has another active socket connection
      const remainingSockets = await io
        .in(playerChannel(identity.playerId))
        .fetchSockets();
      if (remainingSockets.length > 0) {
        return;
      }

      const disconnected = await roomManager.markPlayerDisconnected(
        identity.playerId
      );
      await store.setPresence({
        playerId: identity.playerId,
        name: identity.name,
        roomCode: disconnected?.roomCode ?? null,
        connected: false,
        updatedAt: Date.now(),
      });

      if (disconnected) {
        io.to(roomChannel(disconnected.roomCode)).emit(
          SOCKET_EVENTS.ROOM_STATE,
          disconnected.room
        );

        // Start 60s disconnect grace period; if player does not reconnect, bot takes over seat
        if (disconnected.room.status === 'IN_GAME') {
          clearGraceTimer(identity.playerId);
          const gTimer = setTimeout(async () => {
            graceTimersByPlayer.delete(identity.playerId);
            if (isClosing) return;

            const botActivated = await roomManager.activateBotForPlayer(
              disconnected.roomCode,
              identity.playerId
            );
            if (botActivated) {
              io.to(roomChannel(disconnected.roomCode)).emit(
                SOCKET_EVENTS.ROOM_STATE,
                botActivated.room
              );
              await scheduleRoomLifecycleTimers(disconnected.roomCode);
            }
          }, disconnectGraceMs);

          graceTimersByPlayer.set(identity.playerId, gTimer);
        }
      }
    });
  });

  return {
    io,
    httpServer,
    store,
    accountRepo,
    roomManager,
    chatModerator,
    rateLimiter,
    listen(port = Number(process.env.SERVER_PORT ?? 3001)): Promise<number> {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => {
          const address = httpServer.address();
          const boundPort =
            typeof address === 'object' && address !== null ? address.port : port;
          resolve(boundPort);
        });
      });
    },
    async close(): Promise<void> {
      isClosing = true;
      for (const timer of turnTimersByRoom.values()) {
        clearTimeout(timer);
      }
      turnTimersByRoom.clear();
      for (const timer of botTimersByRoom.values()) {
        clearTimeout(timer);
      }
      botTimersByRoom.clear();
      for (const timer of graceTimersByPlayer.values()) {
        clearTimeout(timer);
      }
      graceTimersByPlayer.clear();

      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
      if (ownedHttpServer && httpServer.listening) {
        await new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
        });
      }
      await store.close();
      if (ownedAccountRepo) {
        await accountRepo.close();
      }
    },
  };
}

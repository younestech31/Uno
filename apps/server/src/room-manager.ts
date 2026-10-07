import crypto from 'node:crypto';
import {
  DEFAULT_HOUSE_RULES,
  createGame,
  getPlayerView,
  getSpectatorView,
  reduce,
  type GameAction,
  type GameEvent,
  type GameState,
  type HouseRules,
  type PlayerView,
} from '@cardclash/engine';
import type {
  ClientGameActionIntent,
  MatchHistoryEntry,
  MatchHistoryParticipant,
  ProtocolErrorPayload,
  PublicRoomState,
  ReplayActionEntry,
  ReplayDataBundle,
  RoomCreateIntent,
} from '@cardclash/protocol';
import {
  getSharedAccountRepository,
  type AccountRepository,
} from './account-repo';
import type { SessionIdentity } from './auth';
import type {
  LoggedMatchAction,
  MatchActionLog,
  RoomPlayerRecord,
  RoomSnapshot,
  RoomSpectatorRecord,
  StateStore,
} from './store';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateFourLetterCode(): string {
  const bytes = crypto.randomBytes(4);
  let code = '';
  for (let i = 0; i < 4; i++) {
    const idx = bytes[i]! % ROOM_CODE_ALPHABET.length;
    code += ROOM_CODE_ALPHABET[idx]!;
  }
  return code;
}

export function toPublicRoomState(snapshot: RoomSnapshot): PublicRoomState {
  const spectatorCount = snapshot.spectators?.length ?? 0;
  return {
    roomCode: snapshot.roomCode,
    status: snapshot.status,
    hostPlayerId: snapshot.hostPlayerId,
    players: snapshot.players.map((p) => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      connected: p.connected,
      isHost: p.id === snapshot.hostPlayerId,
      isBot: p.isBot ?? false,
      isGuest: p.isGuest ?? true,
      disconnectedAt: p.disconnectedAt ?? null,
    })),
    spectators: snapshot.spectators?.map((s) => ({ id: s.id, name: s.name })) ?? [],
    spectatorCount,
    houseRules: { ...snapshot.houseRules },
    targetScore: snapshot.targetScore,
    maxPlayers: snapshot.maxPlayers,
    matchId: snapshot.gameState ? snapshot.gameState.matchId : null,
    turnDeadlineAt: snapshot.turnDeadlineAt ?? null,
  };
}

export type ManagerResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ProtocolErrorPayload };

function err<T>(code: string, message: string): ManagerResult<T> {
  return { ok: false, error: { code, message } };
}

export interface StartOrActionSuccess {
  readonly room: PublicRoomState;
  readonly snapshot: RoomSnapshot;
  readonly matchId: string;
  readonly events: readonly GameEvent[];
  readonly viewsByPlayer: Readonly<Record<string, PlayerView>>;
  readonly spectatorView?: PlayerView | null;
  readonly completedMatchHistory?: MatchHistoryEntry | null;
}

/**
 * Room-scoped authoritative game & lobby manager.
 * Persists a snapshot to the StateStore (Redis or In-Memory) after every mutation/action
 * and records completed matches + OpenSkill ratings in AccountRepository.
 */
export class RoomManager {
  private readonly store: StateStore;
  private readonly accountRepo: AccountRepository;

  constructor(store: StateStore, accountRepo?: AccountRepository) {
    this.store = store;
    this.accountRepo = accountRepo ?? getSharedAccountRepository();
  }

  public getStore(): StateStore {
    return this.store;
  }

  public getAccountRepository(): AccountRepository {
    return this.accountRepo;
  }

  private async allocateUniqueRoomCode(): Promise<string> {
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = generateFourLetterCode();
      const existing = await this.store.getRoomSnapshot(code);
      if (!existing) {
        return code;
      }
    }
    throw new Error('Failed to allocate a unique 4-letter room code');
  }

  public async createRoom(
    user: SessionIdentity,
    options?: RoomCreateIntent
  ): Promise<ManagerResult<{ room: PublicRoomState }>> {
    const existingRoomCode = await this.store.getPlayerRoom(user.playerId);
    if (existingRoomCode) {
      await this.leaveRoom(user.playerId, existingRoomCode);
    }

    await this.accountRepo.upsertAccount({
      playerId: user.playerId,
      name: user.name,
      email: user.email,
      isGuest: user.isGuest,
    });

    const roomCode = await this.allocateUniqueRoomCode();
    const now = Date.now();
    const isNoMercy = options?.houseRules?.gameMode === 'NO_MERCY';
    const houseRules: HouseRules = {
      ...DEFAULT_HOUSE_RULES,
      ...(isNoMercy ? { gameMode: 'NO_MERCY' as const, stacking: true, sevenZeroSwap: true } : {}),
      ...options?.houseRules,
    };
    const targetScore = options?.targetScore ?? (isNoMercy ? 1000 : 500);
    const maxPlayers = options?.maxPlayers ?? 4;

    const hostRecord: RoomPlayerRecord = {
      id: user.playerId,
      name: user.name,
      ready: false,
      connected: true,
      joinedAt: now,
      isBot: false,
      isGuest: user.isGuest ?? true,
      email: user.email ?? null,
      disconnectedAt: null,
    };

    const snapshot: RoomSnapshot = {
      roomCode,
      status: 'LOBBY',
      hostPlayerId: user.playerId,
      players: [hostRecord],
      houseRules,
      targetScore,
      maxPlayers,
      createdAt: now,
      updatedAt: now,
      turnDeadlineAt: null,
      gameState: null,
      matchLog: null,
    };

    await this.store.saveRoomSnapshot(snapshot);
    await this.store.setPlayerRoom(user.playerId, roomCode);
    await this.store.setPresence({
      playerId: user.playerId,
      name: user.name,
      roomCode,
      connected: true,
      updatedAt: now,
    });

    return {
      ok: true,
      data: { room: toPublicRoomState(snapshot) },
    };
  }

  public async joinRoom(
    user: SessionIdentity,
    rawRoomCode: string
  ): Promise<
    ManagerResult<{
      room: PublicRoomState;
      view: PlayerView | null;
      turnDeadlineAt: number | null;
    }>
  > {
    const roomCode = rawRoomCode.trim().toUpperCase();
    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot) {
      return err('ROOM_NOT_FOUND', `Room "${roomCode}" does not exist`);
    }

    await this.accountRepo.upsertAccount({
      playerId: user.playerId,
      name: user.name,
      email: user.email,
      isGuest: user.isGuest,
    });

    const now = Date.now();
    const existingIdx = snapshot.players.findIndex((p) => p.id === user.playerId);

    // Reconnecting / re-joining existing seat
    if (existingIdx !== -1) {
      const updatedPlayers = snapshot.players.map((p, idx) =>
        idx === existingIdx
          ? {
              ...p,
              name: user.name,
              connected: true,
              isBot: false,
              isGuest: user.isGuest ?? p.isGuest ?? true,
              email: user.email ?? p.email ?? null,
              disconnectedAt: null,
            }
          : p
      );

      const updatedGameState = snapshot.gameState
        ? {
            ...snapshot.gameState,
            players: snapshot.gameState.players.map((p) =>
              p.id === user.playerId ? { ...p, name: user.name, connected: true } : p
            ),
          }
        : null;

      const nextSnapshot: RoomSnapshot = {
        ...snapshot,
        players: updatedPlayers,
        gameState: updatedGameState,
        updatedAt: now,
      };

      await this.store.saveRoomSnapshot(nextSnapshot);
      await this.store.setPlayerRoom(user.playerId, roomCode);
      await this.store.setPresence({
        playerId: user.playerId,
        name: user.name,
        roomCode,
        connected: true,
        updatedAt: now,
      });

      const view = updatedGameState
        ? getPlayerView(updatedGameState, user.playerId)
        : null;

      return {
        ok: true,
        data: {
          room: toPublicRoomState(nextSnapshot),
          view,
          turnDeadlineAt: nextSnapshot.turnDeadlineAt ?? null,
        },
      };
    }

    if (snapshot.status !== 'LOBBY') {
      return err('ROOM_ALREADY_STARTED', 'Cannot join a room after the match has started');
    }

    if (snapshot.players.length >= snapshot.maxPlayers) {
      return err('ROOM_FULL', `Room "${roomCode}" is full (${snapshot.maxPlayers} players max)`);
    }

    const previousRoom = await this.store.getPlayerRoom(user.playerId);
    if (previousRoom && previousRoom !== roomCode) {
      await this.leaveRoom(user.playerId, previousRoom);
    }

    const newMember: RoomPlayerRecord = {
      id: user.playerId,
      name: user.name,
      ready: false,
      connected: true,
      joinedAt: now,
      isBot: false,
      isGuest: user.isGuest ?? true,
      email: user.email ?? null,
      disconnectedAt: null,
    };

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      players: [...snapshot.players, newMember],
      updatedAt: now,
    };

    await this.store.saveRoomSnapshot(nextSnapshot);
    await this.store.setPlayerRoom(user.playerId, roomCode);
    await this.store.setPresence({
      playerId: user.playerId,
      name: user.name,
      roomCode,
      connected: true,
      updatedAt: now,
    });

    return {
      ok: true,
      data: {
        room: toPublicRoomState(nextSnapshot),
        view: null,
        turnDeadlineAt: null,
      },
    };
  }

  /**
   * Automatically restores a player's seat on socket handshake reconnect if they belong to a room.
   */
  public async reconnectPlayer(
    user: SessionIdentity
  ): Promise<{
    readonly roomCode: string;
    readonly room: PublicRoomState;
    readonly view: PlayerView | null;
    readonly turnDeadlineAt: number | null;
  } | null> {
    await this.accountRepo.upsertAccount({
      playerId: user.playerId,
      name: user.name,
      email: user.email,
      isGuest: user.isGuest,
    });

    const roomCode = await this.store.getPlayerRoom(user.playerId);
    if (!roomCode) return null;

    const joined = await this.joinRoom(user, roomCode);
    if (!joined.ok) return null;

    return {
      roomCode: joined.data.room.roomCode,
      room: joined.data.room,
      view: joined.data.view,
      turnDeadlineAt: joined.data.turnDeadlineAt,
    };
  }

  /**
   * Marks a player as disconnected when their socket drops (without removing their seat),
   * enabling the 60s reconnect grace timer before a server bot takes over.
   */
  public async markPlayerDisconnected(
    playerId: string
  ): Promise<{
    readonly roomCode: string;
    readonly room: PublicRoomState;
    readonly snapshot: RoomSnapshot;
  } | null> {
    const roomCode = await this.store.getPlayerRoom(playerId);
    if (!roomCode) return null;

    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot) return null;

    const idx = snapshot.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return null;

    const now = Date.now();
    const updatedPlayers = snapshot.players.map((p, i) =>
      i === idx ? { ...p, connected: false, disconnectedAt: now } : p
    );

    const updatedGameState = snapshot.gameState
      ? {
          ...snapshot.gameState,
          players: snapshot.gameState.players.map((p) =>
            p.id === playerId ? { ...p, connected: false } : p
          ),
        }
      : null;

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      players: updatedPlayers,
      gameState: updatedGameState,
      updatedAt: now,
    };

    await this.store.saveRoomSnapshot(nextSnapshot);
    return {
      roomCode: nextSnapshot.roomCode,
      room: toPublicRoomState(nextSnapshot),
      snapshot: nextSnapshot,
    };
  }

  /**
   * Activates a simple server-side bot for a disconnected player's seat after the 60s grace period expires.
   */
  public async activateBotForPlayer(
    roomCode: string,
    playerId: string
  ): Promise<{
    readonly room: PublicRoomState;
    readonly snapshot: RoomSnapshot;
  } | null> {
    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot) return null;

    const member = snapshot.players.find((p) => p.id === playerId);
    if (!member || member.connected) {
      return null;
    }

    const updatedPlayers = snapshot.players.map((p) =>
      p.id === playerId ? { ...p, isBot: true } : p
    );

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      players: updatedPlayers,
      updatedAt: Date.now(),
    };

    await this.store.saveRoomSnapshot(nextSnapshot);
    return {
      room: toPublicRoomState(nextSnapshot),
      snapshot: nextSnapshot,
    };
  }

  public async updateTurnDeadline(
    roomCode: string,
    turnDeadlineAt: number | null
  ): Promise<RoomSnapshot | null> {
    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot) return null;

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      turnDeadlineAt,
      updatedAt: Date.now(),
    };
    await this.store.saveRoomSnapshot(nextSnapshot);
    return nextSnapshot;
  }

  public async leaveRoom(
    playerId: string,
    explicitRoomCode?: string
  ): Promise<
    ManagerResult<{
      roomCode: string;
      room: PublicRoomState | null;
    }>
  > {
    const roomCode = (
      explicitRoomCode ?? (await this.store.getPlayerRoom(playerId)) ?? ''
    )
      .trim()
      .toUpperCase();

    if (!roomCode) {
      return err('NOT_IN_ROOM', 'Player is not currently in a room');
    }

    const snapshot = await this.store.getRoomSnapshot(roomCode);
    await this.store.setPlayerRoom(playerId, null);

    if (!snapshot) {
      return { ok: true, data: { roomCode, room: null } };
    }

    const now = Date.now();

    const isSpectator = snapshot.spectators?.some((s) => s.id === playerId);
    if (isSpectator) {
      const remainingSpectators = (snapshot.spectators ?? []).filter(
        (s) => s.id !== playerId
      );
      const nextSnapshot: RoomSnapshot = {
        ...snapshot,
        spectators: remainingSpectators,
        updatedAt: now,
      };
      await this.store.saveRoomSnapshot(nextSnapshot);
      return {
        ok: true,
        data: { roomCode, room: toPublicRoomState(nextSnapshot) },
      };
    }

    const memberExists = snapshot.players.some((p) => p.id === playerId);
    if (!memberExists) {
      const hasActiveHumans = snapshot.players.some((p) => p.connected && !p.isBot);
      if (!hasActiveHumans) {
        for (const p of snapshot.players) {
          await this.store.setPlayerRoom(p.id, null);
        }
        await this.store.deleteRoomSnapshot(roomCode);
        return { ok: true, data: { roomCode, room: null } };
      }
      return { ok: true, data: { roomCode, room: toPublicRoomState(snapshot) } };
    }

    if (snapshot.status === 'LOBBY') {
      const remaining = snapshot.players.filter((p) => p.id !== playerId);
      const hasConnectedHuman = remaining.some((p) => p.connected && !p.isBot);
      if (remaining.length === 0 || !hasConnectedHuman) {
        for (const p of remaining) {
          await this.store.setPlayerRoom(p.id, null);
        }
        await this.store.deleteRoomSnapshot(roomCode);
        return { ok: true, data: { roomCode, room: null } };
      }

      const nextHostId =
        snapshot.hostPlayerId === playerId
          ? remaining[0]!.id
          : snapshot.hostPlayerId;

      const nextSnapshot: RoomSnapshot = {
        ...snapshot,
        hostPlayerId: nextHostId,
        players: remaining,
        updatedAt: now,
      };

      await this.store.saveRoomSnapshot(nextSnapshot);
      return {
        ok: true,
        data: { roomCode, room: toPublicRoomState(nextSnapshot) },
      };
    }

    const updatedPlayers = snapshot.players.map((p) =>
      p.id === playerId
        ? { ...p, connected: false, isBot: true, disconnectedAt: now }
        : p
    );

    const hasRemainingHuman = updatedPlayers.some((p) => p.connected && !p.isBot);
    if (!hasRemainingHuman) {
      for (const p of snapshot.players) {
        await this.store.setPlayerRoom(p.id, null);
      }
      await this.store.deleteRoomSnapshot(roomCode);
      return { ok: true, data: { roomCode, room: null } };
    }

    const nextHostId =
      snapshot.hostPlayerId === playerId
        ? (updatedPlayers.find((p) => p.connected && !p.isBot)?.id ?? snapshot.hostPlayerId)
        : snapshot.hostPlayerId;

    const updatedGameState = snapshot.gameState
      ? {
          ...snapshot.gameState,
          players: snapshot.gameState.players.map((p) =>
            p.id === playerId ? { ...p, connected: false } : p
          ),
        }
      : null;

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      hostPlayerId: nextHostId,
      players: updatedPlayers,
      gameState: updatedGameState,
      updatedAt: now,
    };

    await this.store.saveRoomSnapshot(nextSnapshot);
    return {
      ok: true,
      data: { roomCode, room: toPublicRoomState(nextSnapshot) },
    };
  }

  public async setReady(
    playerId: string,
    ready: boolean,
    explicitRoomCode?: string
  ): Promise<ManagerResult<{ room: PublicRoomState }>> {
    const roomCode = (
      explicitRoomCode ?? (await this.store.getPlayerRoom(playerId)) ?? ''
    )
      .trim()
      .toUpperCase();

    if (!roomCode) {
      return err('NOT_IN_ROOM', 'You must join a room before setting ready status');
    }

    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot) {
      return err('ROOM_NOT_FOUND', `Room "${roomCode}" does not exist`);
    }

    if (snapshot.status !== 'LOBBY') {
      return err('ROOM_ALREADY_STARTED', 'Cannot change ready state once match has started');
    }

    const memberIdx = snapshot.players.findIndex((p) => p.id === playerId);
    if (memberIdx === -1) {
      return err('NOT_IN_ROOM', `You are not a member of room "${roomCode}"`);
    }

    const updatedPlayers = snapshot.players.map((p, idx) =>
      idx === memberIdx ? { ...p, ready } : p
    );

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      players: updatedPlayers,
      updatedAt: Date.now(),
    };

    await this.store.saveRoomSnapshot(nextSnapshot);
    return {
      ok: true,
      data: { room: toPublicRoomState(nextSnapshot) },
    };
  }

  private async initializeFreshMatchOnSnapshot(
    snapshot: RoomSnapshot,
    turnTimeoutMs = 30_000
  ): Promise<StartOrActionSuccess> {
    const roomCode = snapshot.roomCode;
    const seed = crypto.randomBytes(32).toString('hex');
    const matchId = `match_${roomCode}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    const turnDeadlineAt = now + turnTimeoutMs;

    const gameState = createGame({
      matchId,
      seed,
      players: snapshot.players.map((p) => ({ id: p.id, name: p.name })),
      houseRules: snapshot.houseRules,
      targetScore: snapshot.targetScore,
      maxPlayers: snapshot.maxPlayers,
    });

    const matchLog: MatchActionLog = {
      matchId,
      roomCode,
      seed,
      startedAt: now,
      players: snapshot.players.map((p) => ({ id: p.id, name: p.name })),
      houseRules: snapshot.houseRules,
      targetScore: snapshot.targetScore,
      actions: [],
    };

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      status: 'IN_GAME',
      updatedAt: now,
      turnDeadlineAt,
      gameState,
      matchLog,
    };

    await this.store.saveRoomSnapshot(nextSnapshot);

    const viewsByPlayer: Record<string, PlayerView> = {};
    for (const p of snapshot.players) {
      viewsByPlayer[p.id] = getPlayerView(gameState, p.id);
    }

    const firstCard = gameState.discardPile[gameState.discardPile.length - 1]!;
    const startingPlayer = gameState.players[gameState.currentPlayerIndex]!;

    return {
      room: toPublicRoomState(nextSnapshot),
      snapshot: nextSnapshot,
      matchId,
      events: [
        {
          type: 'ROUND_STARTED',
          roundNumber: 1,
          firstCard,
          startingPlayerId: startingPlayer.id,
          direction: gameState.direction,
        },
      ],
      viewsByPlayer,
      completedMatchHistory: null,
    };
  }

  public async startMatch(
    playerId: string,
    explicitRoomCode?: string,
    turnTimeoutMs = 30_000
  ): Promise<ManagerResult<StartOrActionSuccess>> {
    const roomCode = (
      explicitRoomCode ?? (await this.store.getPlayerRoom(playerId)) ?? ''
    )
      .trim()
      .toUpperCase();

    if (!roomCode) {
      return err('NOT_IN_ROOM', 'You are not in a room');
    }

    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot) {
      return err('ROOM_NOT_FOUND', `Room "${roomCode}" does not exist`);
    }

    if (snapshot.status !== 'LOBBY') {
      return err('ROOM_ALREADY_STARTED', 'Match has already started');
    }

    if (snapshot.hostPlayerId !== playerId) {
      return err('NOT_HOST', 'Only the room host can start the match');
    }

    if (snapshot.players.length < 2) {
      return err('NOT_ENOUGH_PLAYERS', 'At least 2 players are required to start a match');
    }

    const allReady = snapshot.players.every((p) => p.ready);
    if (!allReady) {
      return err('PLAYERS_NOT_READY', 'All players in the room must be ready before starting');
    }

    const started = await this.initializeFreshMatchOnSnapshot(
      snapshot,
      turnTimeoutMs
    );
    return {
      ok: true,
      data: started,
    };
  }

  /**
   * Starts a rematch in an existing room with reset scores and a new cryptographic seed.
   */
  public async rematch(
    playerId: string,
    explicitRoomCode?: string,
    turnTimeoutMs = 30_000
  ): Promise<ManagerResult<StartOrActionSuccess>> {
    const roomCode = (
      explicitRoomCode ?? (await this.store.getPlayerRoom(playerId)) ?? ''
    )
      .trim()
      .toUpperCase();

    if (!roomCode) {
      return err('NOT_IN_ROOM', 'You are not in a room');
    }

    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot) {
      return err('ROOM_NOT_FOUND', `Room "${roomCode}" does not exist`);
    }

    const isMember = snapshot.players.some((p) => p.id === playerId);
    if (!isMember) {
      return err('NOT_IN_ROOM', 'Only seated room players can start a rematch');
    }

    if (snapshot.players.length < 2) {
      return err('NOT_ENOUGH_PLAYERS', 'At least 2 players are required for a rematch');
    }

    const started = await this.initializeFreshMatchOnSnapshot(
      snapshot,
      turnTimeoutMs
    );
    return {
      ok: true,
      data: started,
    };
  }

  public async handleGameAction(
    authenticatedPlayerId: string,
    intent: ClientGameActionIntent,
    explicitRoomCode?: string,
    turnTimeoutMs = 30_000
  ): Promise<ManagerResult<StartOrActionSuccess>> {
    if (intent.playerId && intent.playerId !== authenticatedPlayerId) {
      return err(
        'IDENTITY_MISMATCH',
        'Action playerId does not match authenticated session token'
      );
    }

    const roomCode = (
      explicitRoomCode ??
      (await this.store.getPlayerRoom(authenticatedPlayerId)) ??
      ''
    )
      .trim()
      .toUpperCase();

    if (!roomCode) {
      return err('NOT_IN_ROOM', 'Player is not in an active room');
    }

    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot || !snapshot.gameState || !snapshot.matchLog) {
      return err('ROOM_NOT_FOUND', `No active game found in room "${roomCode}"`);
    }

    const engineAction: GameAction = {
      ...intent,
      playerId: authenticatedPlayerId,
    };

    const result = reduce(snapshot.gameState, engineAction);
    if (!result.ok) {
      return err(result.error.code, result.error.message);
    }

    const now = Date.now();
    const loggedEntry: LoggedMatchAction = {
      index: snapshot.matchLog.actions.length,
      timestamp: now,
      action: engineAction,
      events: result.events,
    };

    const updatedMatchLog: MatchActionLog = {
      ...snapshot.matchLog,
      actions: [...snapshot.matchLog.actions, loggedEntry],
    };

    const nextStatus =
      result.state.status === 'MATCH_OVER' ? 'FINISHED' : snapshot.status;
    const nextTurnDeadlineAt =
      result.state.status === 'IN_PROGRESS' ? now + turnTimeoutMs : null;

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      status: nextStatus,
      updatedAt: now,
      turnDeadlineAt: nextTurnDeadlineAt,
      gameState: result.state,
      matchLog: updatedMatchLog,
    };

    await this.store.saveRoomSnapshot(nextSnapshot);

    // If the match just reached MATCH_OVER, automatically record match history from MatchActionLog
    // and update all seated players' OpenSkill ratings!
    let completedMatchHistory: MatchHistoryEntry | null = null;
    if (result.state.status === 'MATCH_OVER') {
      const playerMeta: Record<
        string,
        { email?: string | null; isGuest?: boolean }
      > = {};
      for (const p of nextSnapshot.players) {
        playerMeta[p.id] = {
          email: p.email ?? null,
          isGuest: p.isGuest ?? true,
        };
      }
      completedMatchHistory =
        await this.accountRepo.recordCompletedMatchFromLog({
          matchLog: updatedMatchLog,
          finalState: result.state,
          playerMeta,
        });
    }

    const viewsByPlayer: Record<string, PlayerView> = {};
    for (const p of nextSnapshot.players) {
      viewsByPlayer[p.id] = getPlayerView(result.state, p.id);
    }

    return {
      ok: true,
      data: {
        room: toPublicRoomState(nextSnapshot),
        snapshot: nextSnapshot,
        matchId: result.state.matchId,
        events: result.events,
        viewsByPlayer,
        completedMatchHistory,
      },
    };
  }

  /**
   * Alias for startMatch to support uniform room lifecycle calling.
   */
  public async startRoom(
    playerId: string,
    explicitRoomCode?: string,
    turnTimeoutMs = 30_000
  ): Promise<ManagerResult<StartOrActionSuccess>> {
    return this.startMatch(playerId, explicitRoomCode, turnTimeoutMs);
  }

  /**
   * Adds a non-seated spectator to an active or lobby room without consuming a player seat.
   */
  public async spectateRoom(
    user: SessionIdentity,
    rawRoomCode: string
  ): Promise<
    ManagerResult<{
      room: PublicRoomState;
      view: PlayerView | null;
      turnDeadlineAt: number | null;
    }>
  > {
    const roomCode = rawRoomCode.trim().toUpperCase();
    const snapshot = await this.store.getRoomSnapshot(roomCode);
    if (!snapshot) {
      return err('ROOM_NOT_FOUND', `Room "${roomCode}" does not exist`);
    }

    const now = Date.now();
    const currentSpectators = snapshot.spectators ?? [];
    const exists = currentSpectators.some((s) => s.id === user.playerId);
    const updatedSpectators: readonly RoomSpectatorRecord[] = exists
      ? currentSpectators.map((s) =>
          s.id === user.playerId
            ? { id: user.playerId, name: user.name, joinedAt: s.joinedAt }
            : s
        )
      : [
          ...currentSpectators,
          { id: user.playerId, name: user.name, joinedAt: now },
        ];

    const nextSnapshot: RoomSnapshot = {
      ...snapshot,
      spectators: updatedSpectators,
      updatedAt: now,
    };

    await this.store.saveRoomSnapshot(nextSnapshot);
    await this.store.setPlayerRoom(user.playerId, roomCode);

    const spectatorView = snapshot.gameState
      ? this.getSpectatorView(snapshot.gameState, user.playerId)
      : null;

    return {
      ok: true,
      data: {
        room: toPublicRoomState(nextSnapshot),
        view: spectatorView,
        turnDeadlineAt: nextSnapshot.turnDeadlineAt ?? null,
      },
    };
  }

  /**
   * Generates a sanitized PlayerView for spectators with an empty hand.
   */
  public getSpectatorView(
    gameState: GameState,
    spectatorId = 'spectator'
  ): PlayerView {
    return getSpectatorView(gameState, spectatorId);
  }

  /**
   * Retrieves deterministic match replay data from the store or account history.
   */
  public async getReplayData(
    matchId: string
  ): Promise<ReplayDataBundle | null> {
    const log = await this.store.getMatchLog(matchId);
    if (log) {
      const actions: ReplayActionEntry[] = log.actions.map((la) => ({
        index: la.index,
        timestamp: la.timestamp,
        action: la.action as unknown as ClientGameActionIntent,
        events: la.events,
      }));

      return {
        matchId: log.matchId,
        roomCode: log.roomCode,
        seed: log.seed,
        startedAt: log.startedAt,
        completedAt:
          log.actions[log.actions.length - 1]?.timestamp ?? log.startedAt,
        targetScore: log.targetScore,
        houseRules: log.houseRules,
        players: log.players.map((p) => ({
          id: p.id,
          name: p.name,
        })),
        actions,
      };
    }

    const entry = await this.accountRepo.getMatchHistoryEntry(matchId);
    if (!entry) return null;

    return {
      matchId: entry.matchId,
      roomCode: entry.roomCode,
      seed: entry.seed,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      targetScore: entry.targetScore,
      houseRules: DEFAULT_HOUSE_RULES,
      winnerId: entry.winnerId,
      winnerName: entry.winnerName,
      players: entry.participants.map((p: MatchHistoryParticipant) => ({
        id: p.playerId,
        name: p.name,
        isGuest: p.isGuest,
      })),
      actions: [],
    };
  }
}

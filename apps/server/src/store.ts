import Redis from 'ioredis';
import type {
  GameAction,
  GameEvent,
  GameState,
  HouseRules,
} from '@cardclash/engine';
import type { RoomStatus } from '@cardclash/protocol';

export interface RoomPlayerRecord {
  readonly id: string;
  readonly name: string;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly joinedAt: number;
  readonly isBot?: boolean;
  readonly isGuest?: boolean;
  readonly email?: string | null;
  readonly disconnectedAt?: number | null;
}

export interface LoggedMatchAction {
  readonly index: number;
  readonly timestamp: number;
  readonly action: GameAction;
  readonly events: readonly GameEvent[];
}

export interface MatchActionLog {
  readonly matchId: string;
  readonly roomCode: string;
  readonly seed: string;
  readonly startedAt: number;
  readonly players: readonly { readonly id: string; readonly name: string }[];
  readonly houseRules: HouseRules;
  readonly targetScore: number;
  readonly actions: readonly LoggedMatchAction[];
}

export interface RoomSpectatorRecord {
  readonly id: string;
  readonly name: string;
  readonly joinedAt: number;
}

export interface RoomSnapshot {
  readonly roomCode: string;
  readonly status: RoomStatus;
  readonly hostPlayerId: string;
  readonly players: readonly RoomPlayerRecord[];
  readonly spectators?: readonly RoomSpectatorRecord[];
  readonly houseRules: HouseRules;
  readonly targetScore: number;
  readonly maxPlayers: number;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly turnDeadlineAt?: number | null;
  readonly gameState: GameState | null;
  readonly matchLog: MatchActionLog | null;
}

export interface PlayerPresence {
  readonly playerId: string;
  readonly name: string;
  readonly roomCode: string | null;
  readonly connected: boolean;
  readonly updatedAt: number;
}

export interface StateStore {
  readonly backend: 'redis' | 'memory';
  saveRoomSnapshot(snapshot: RoomSnapshot): Promise<void>;
  getRoomSnapshot(roomCode: string): Promise<RoomSnapshot | null>;
  deleteRoomSnapshot(roomCode: string): Promise<void>;
  listRoomCodes(): Promise<string[]>;
  getPlayerRoom(playerId: string): Promise<string | null>;
  setPlayerRoom(playerId: string, roomCode: string | null): Promise<void>;
  setPresence(presence: PlayerPresence): Promise<void>;
  getPresence(playerId: string): Promise<PlayerPresence | null>;
  saveMatchLog(log: MatchActionLog): Promise<void>;
  getMatchLog(matchId: string): Promise<MatchActionLog | null>;
  close(): Promise<void>;
}

/**
 * In-memory fallback store used when REDIS_URL is unset.
 */
export class InMemoryStateStore implements StateStore {
  public readonly backend = 'memory' as const;
  private readonly rooms = new Map<string, string>();
  private readonly playerRooms = new Map<string, string>();
  private readonly presences = new Map<string, string>();
  private readonly matchLogs = new Map<string, string>();

  public async saveRoomSnapshot(snapshot: RoomSnapshot): Promise<void> {
    const code = snapshot.roomCode.toUpperCase();
    this.rooms.set(code, JSON.stringify(snapshot));
    if (snapshot.matchLog) {
      this.matchLogs.set(snapshot.matchLog.matchId, JSON.stringify(snapshot.matchLog));
    }
  }

  public async getRoomSnapshot(roomCode: string): Promise<RoomSnapshot | null> {
    const raw = this.rooms.get(roomCode.toUpperCase());
    if (!raw) return null;
    return JSON.parse(raw) as RoomSnapshot;
  }

  public async deleteRoomSnapshot(roomCode: string): Promise<void> {
    this.rooms.delete(roomCode.toUpperCase());
  }

  public async listRoomCodes(): Promise<string[]> {
    return Array.from(this.rooms.keys());
  }

  public async getPlayerRoom(playerId: string): Promise<string | null> {
    return this.playerRooms.get(playerId) ?? null;
  }

  public async setPlayerRoom(playerId: string, roomCode: string | null): Promise<void> {
    if (!roomCode) {
      this.playerRooms.delete(playerId);
    } else {
      this.playerRooms.set(playerId, roomCode.toUpperCase());
    }
  }

  public async setPresence(presence: PlayerPresence): Promise<void> {
    this.presences.set(presence.playerId, JSON.stringify(presence));
  }

  public async getPresence(playerId: string): Promise<PlayerPresence | null> {
    const raw = this.presences.get(playerId);
    if (!raw) return null;
    return JSON.parse(raw) as PlayerPresence;
  }

  public async saveMatchLog(log: MatchActionLog): Promise<void> {
    this.matchLogs.set(log.matchId, JSON.stringify(log));
  }

  public async getMatchLog(matchId: string): Promise<MatchActionLog | null> {
    const raw = this.matchLogs.get(matchId);
    if (!raw) return null;
    return JSON.parse(raw) as MatchActionLog;
  }

  public async close(): Promise<void> {
    this.rooms.clear();
    this.playerRooms.clear();
    this.presences.clear();
    this.matchLogs.clear();
  }
}

/**
 * Redis-backed store using ioredis for room snapshots, room-code lookup, match logs, and presence.
 */
export class RedisStateStore implements StateStore {
  public readonly backend = 'redis' as const;
  private readonly redis: Redis;
  private readonly prefix: string;

  constructor(redisUrl: string, prefix = 'cardclash:') {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
    });
    this.prefix = prefix;
  }

  private roomKey(code: string): string {
    return `${this.prefix}room:${code.toUpperCase()}:snapshot`;
  }

  private roomSetKey(): string {
    return `${this.prefix}rooms:active`;
  }

  private playerRoomKey(playerId: string): string {
    return `${this.prefix}player:${playerId}:room`;
  }

  private presenceKey(playerId: string): string {
    return `${this.prefix}presence:${playerId}`;
  }

  private matchLogKey(matchId: string): string {
    return `${this.prefix}match:${matchId}:log`;
  }

  public async saveRoomSnapshot(snapshot: RoomSnapshot): Promise<void> {
    const code = snapshot.roomCode.toUpperCase();
    const multi = this.redis.multi();
    multi.set(this.roomKey(code), JSON.stringify(snapshot), 'EX', 60 * 60 * 12);
    multi.sadd(this.roomSetKey(), code);
    if (snapshot.matchLog) {
      multi.set(
        this.matchLogKey(snapshot.matchLog.matchId),
        JSON.stringify(snapshot.matchLog),
        'EX',
        60 * 60 * 24 * 7
      );
    }
    await multi.exec();
  }

  public async getRoomSnapshot(roomCode: string): Promise<RoomSnapshot | null> {
    const raw = await this.redis.get(this.roomKey(roomCode));
    if (!raw) return null;
    return JSON.parse(raw) as RoomSnapshot;
  }

  public async deleteRoomSnapshot(roomCode: string): Promise<void> {
    const code = roomCode.toUpperCase();
    await this.redis.multi().del(this.roomKey(code)).srem(this.roomSetKey(), code).exec();
  }

  public async listRoomCodes(): Promise<string[]> {
    return await this.redis.smembers(this.roomSetKey());
  }

  public async getPlayerRoom(playerId: string): Promise<string | null> {
    return await this.redis.get(this.playerRoomKey(playerId));
  }

  public async setPlayerRoom(playerId: string, roomCode: string | null): Promise<void> {
    if (!roomCode) {
      await this.redis.del(this.playerRoomKey(playerId));
    } else {
      await this.redis.set(
        this.playerRoomKey(playerId),
        roomCode.toUpperCase(),
        'EX',
        60 * 60 * 12
      );
    }
  }

  public async setPresence(presence: PlayerPresence): Promise<void> {
    await this.redis.set(
      this.presenceKey(presence.playerId),
      JSON.stringify(presence),
      'EX',
      60 * 60 * 12
    );
  }

  public async getPresence(playerId: string): Promise<PlayerPresence | null> {
    const raw = await this.redis.get(this.presenceKey(playerId));
    if (!raw) return null;
    return JSON.parse(raw) as PlayerPresence;
  }

  public async saveMatchLog(log: MatchActionLog): Promise<void> {
    await this.redis.set(
      this.matchLogKey(log.matchId),
      JSON.stringify(log),
      'EX',
      60 * 60 * 24 * 7
    );
  }

  public async getMatchLog(matchId: string): Promise<MatchActionLog | null> {
    const raw = await this.redis.get(this.matchLogKey(matchId));
    if (!raw) return null;
    return JSON.parse(raw) as MatchActionLog;
  }

  public async close(): Promise<void> {
    await this.redis.quit();
  }
}

/**
 * Factory that creates a RedisStateStore if REDIS_URL is set,
 * or falls back cleanly to InMemoryStateStore.
 */
export function createStateStore(redisUrl = process.env.REDIS_URL): StateStore {
  if (redisUrl && redisUrl.trim().length > 0) {
    return new RedisStateStore(redisUrl.trim());
  }
  return new InMemoryStateStore();
}

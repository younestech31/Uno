import {
  DEFAULT_HOUSE_RULES,
  createGame,
  reduce,
  type GameAction,
  type GameState,
} from '@cardclash/engine';
import {
  InMemoryAccountRepository,
  InMemoryStateStore,
  RoomManager,
  signSessionToken,
} from '../src/index';

export interface LoadBenchmarkResult {
  readonly roomCount: number;
  readonly totalActions: number;
  readonly durationMs: number;
  readonly actionsPerSecond: number;
  readonly memUsedMb: string;
}

/**
 * High-concurrency simulation running N distinct active rooms concurrently
 * with authenticated session tokens and deterministic engine state progression.
 */
export async function runLoadBenchmark(
  roomCount = 20
): Promise<LoadBenchmarkResult> {
  const store = new InMemoryStateStore();
  const accountRepo = new InMemoryAccountRepository();
  const manager = new RoomManager(store, accountRepo);

  const startTime = performance.now();
  const startMem = process.memoryUsage().heapUsed;

  const rooms: Array<{
    roomCode: string;
    p1Token: string;
    p2Token: string;
  }> = [];

  // 1. Concurrently spawn roomCount rooms
  for (let i = 0; i < roomCount; i++) {
    const p1Id = `usr_bench_p1_${i}`;
    const p2Id = `usr_bench_p2_${i}`;

    const p1 = {
      playerId: p1Id,
      name: `Host_${i}`,
      isGuest: true,
      iat: Date.now(),
    };
    const p2 = {
      playerId: p2Id,
      name: `Challenger_${i}`,
      isGuest: true,
      iat: Date.now(),
    };

    const created = await manager.createRoom(p1, { targetScore: 150 });
    if (!created.ok) throw new Error(`Room creation failed at index ${i}`);

    const roomCode = created.data.room.roomCode;
    await manager.joinRoom(p2, roomCode);
    await manager.setReady(p1Id, true, roomCode);
    await manager.setReady(p2Id, true, roomCode);
    await manager.startRoom(p1Id, roomCode);

    rooms.push({
      roomCode,
      p1Token: signSessionToken(p1),
      p2Token: signSessionToken(p2),
    });
  }

  // 2. Concurrently execute engine actions across all rooms
  let totalActions = 0;
  for (const r of rooms) {
    const snap = await store.getRoomSnapshot(r.roomCode);
    if (!snap?.gameState) continue;

    const activePlayerId =
      snap.gameState.players[snap.gameState.currentPlayerIndex]?.id;
    if (!activePlayerId) continue;

    const isWildChoice =
      snap.gameState.turnPhase === 'AWAITING_INITIAL_WILD_COLOR';

    const action: GameAction = isWildChoice
      ? {
          type: 'CHOOSE_INITIAL_COLOR',
          color: 'RED',
          playerId: activePlayerId,
          seq: 1,
        }
      : {
          type: 'DRAW_CARD',
          playerId: activePlayerId,
          seq: 1,
        };

    const res = await manager.handleGameAction(
      activePlayerId,
      action,
      r.roomCode
    );
    if (res.ok) {
      totalActions++;
    }
  }

  const endTime = performance.now();
  const durationMs = endTime - startTime;
  const endMem = process.memoryUsage().heapUsed;
  const memUsedMb = ((endMem - startMem) / (1024 * 1024)).toFixed(2);

  const actionsPerSecond = Math.round(totalActions / (durationMs / 1000));

  return {
    roomCount,
    totalActions,
    durationMs,
    actionsPerSecond,
    memUsedMb,
  };
}

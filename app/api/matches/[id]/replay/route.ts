import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_HOUSE_RULES,
} from '@cardclash/engine';
import type {
  ClientGameActionIntent,
  MatchHistoryParticipant,
  ReplayActionEntry,
  ReplayDataBundle,
} from '@cardclash/protocol';
import {
  createStateStore,
  getSharedAccountRepository,
} from '@cardclash/server';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id: matchId } = await context.params;
    if (!matchId) {
      return NextResponse.json({ error: 'Match ID required' }, { status: 400 });
    }

    const store = createStateStore();
    const log = await store.getMatchLog(matchId);
    if (log) {
      const actions: ReplayActionEntry[] = log.actions.map((la) => ({
        index: la.index,
        timestamp: la.timestamp,
        action: la.action as unknown as ClientGameActionIntent,
        events: la.events,
      }));

      const replayData: ReplayDataBundle = {
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

      return NextResponse.json(replayData);
    }

    const accountRepo = getSharedAccountRepository();
    const entry = await accountRepo.getMatchHistoryEntry(matchId);
    if (!entry) {
      return NextResponse.json({ error: 'Replay not found' }, { status: 404 });
    }

    const fallbackBundle: ReplayDataBundle = {
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

    return NextResponse.json(fallbackBundle);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? 'Failed to retrieve replay data' },
      { status: 500 }
    );
  }
}

import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { GameState } from '@cardclash/engine';
import type {
  AccountProfile,
  MatchHistoryEntry,
  MatchHistoryParticipant,
} from '@cardclash/protocol';
import {
  matchParticipantsTable,
  matchesTable,
  usersTable,
} from './db/schema';
import {
  buildOpenSkillRating,
  updateOpenSkillRatings,
} from './openskill';
import type { MatchActionLog } from './store';

export interface UpsertAccountInput {
  readonly playerId: string;
  readonly name: string;
  readonly email?: string | null;
  readonly isGuest?: boolean;
}

export interface RecordMatchFromLogParams {
  readonly matchLog: MatchActionLog;
  readonly finalState: GameState;
  readonly playerMeta?: Readonly<
    Record<string, { readonly email?: string | null; readonly isGuest?: boolean }>
  >;
}

export interface AccountRepository {
  readonly backend: 'postgres' | 'memory';
  upsertAccount(input: UpsertAccountInput): Promise<AccountProfile>;
  getAccount(playerId: string): Promise<AccountProfile | null>;
  findAccountByEmail(email: string): Promise<AccountProfile | null>;
  recordCompletedMatchFromLog(
    params: RecordMatchFromLogParams
  ): Promise<MatchHistoryEntry>;
  getLeaderboard(limit?: number): Promise<AccountProfile[]>;
  getRecentMatches(
    limit?: number,
    playerId?: string
  ): Promise<MatchHistoryEntry[]>;
  getMatchHistoryEntry(matchId: string): Promise<MatchHistoryEntry | null>;
  close(): Promise<void>;
}

/**
 * Ranks match players by matchWinnerId/roundWinnerId first (placement 1), then descending score.
 */
function computePlacements(
  finalState: GameState
): ReadonlyMap<string, number> {
  const resolvedWinnerId =
    finalState.matchWinnerId ?? finalState.roundWinnerId;
  const sorted = [...finalState.players].sort((a, b) => {
    if (a.id === resolvedWinnerId) return -1;
    if (b.id === resolvedWinnerId) return 1;
    return b.score - a.score;
  });

  const placements = new Map<string, number>();
  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i]!;
    if (i > 0) {
      const prev = sorted[i - 1]!;
      if (
        prev.id === resolvedWinnerId ||
        current.score < prev.score
      ) {
        currentRank = i + 1;
      }
    }
    placements.set(current.id, currentRank);
  }
  return placements;
}

export class InMemoryAccountRepository implements AccountRepository {
  public readonly backend = 'memory' as const;
  private readonly accounts = new Map<string, AccountProfile>();
  private readonly matches = new Map<string, MatchHistoryEntry>();

  public async upsertAccount(input: UpsertAccountInput): Promise<AccountProfile> {
    const now = Date.now();
    const existing = this.accounts.get(input.playerId);
    const normalizedEmail =
      typeof input.email === 'string' && input.email.trim().length > 0
        ? input.email.trim().toLowerCase()
        : existing?.email ?? null;
    const isGuest =
      typeof input.isGuest === 'boolean'
        ? input.isGuest
        : normalizedEmail === null;

    if (existing) {
      const updated: AccountProfile = {
        ...existing,
        name: input.name.trim() || existing.name,
        email: normalizedEmail,
        isGuest,
        updatedAt: now,
      };
      this.accounts.set(updated.playerId, updated);
      return updated;
    }

    const created: AccountProfile = {
      playerId: input.playerId,
      name: input.name.trim() || 'Player',
      email: normalizedEmail,
      isGuest,
      rating: buildOpenSkillRating(),
      matchesPlayed: 0,
      matchesWon: 0,
      totalPoints: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.accounts.set(created.playerId, created);
    return created;
  }

  public async getAccount(playerId: string): Promise<AccountProfile | null> {
    return this.accounts.get(playerId) ?? null;
  }

  public async findAccountByEmail(email: string): Promise<AccountProfile | null> {
    const target = email.trim().toLowerCase();
    for (const acc of this.accounts.values()) {
      if (acc.email === target) {
        return acc;
      }
    }
    return null;
  }

  public async recordCompletedMatchFromLog(
    params: RecordMatchFromLogParams
  ): Promise<MatchHistoryEntry> {
    const { matchLog, finalState, playerMeta } = params;
    const existingEntry = this.matches.get(matchLog.matchId);
    if (existingEntry) {
      return existingEntry;
    }

    const now = Date.now();
    const placements = computePlacements(finalState);

    const currentProfiles = new Map<string, AccountProfile>();
    for (const p of finalState.players) {
      const meta = playerMeta?.[p.id];
      const profile = await this.upsertAccount({
        playerId: p.id,
        name: p.name,
        email: meta?.email,
        isGuest: meta?.isGuest,
      });
      currentProfiles.set(p.id, profile);
    }

    const ratingUpdates = updateOpenSkillRatings(
      finalState.players.map((p) => ({
        playerId: p.id,
        rating: currentProfiles.get(p.id)!.rating,
        placement: placements.get(p.id) ?? 2,
      }))
    );

    const updateByPlayer = new Map(
      ratingUpdates.map((u) => [u.playerId, u])
    );

    const participantEntries: MatchHistoryParticipant[] = [];
    for (const p of finalState.players) {
      const profile = currentProfiles.get(p.id)!;
      const update = updateByPlayer.get(p.id)!;
      const placement = placements.get(p.id) ?? 2;
      const won = placement === 1;

      const updatedProfile: AccountProfile = {
        ...profile,
        rating: update.after,
        matchesPlayed: profile.matchesPlayed + 1,
        matchesWon: profile.matchesWon + (won ? 1 : 0),
        totalPoints: profile.totalPoints + p.score,
        updatedAt: now,
      };
      this.accounts.set(p.id, updatedProfile);

      participantEntries.push({
        playerId: p.id,
        name: p.name,
        isGuest: updatedProfile.isGuest,
        placement,
        finalScore: p.score,
        ratingBefore: update.before.displayRating,
        ratingAfter: update.after.displayRating,
        ratingDelta: update.ratingDelta,
      });
    }

    participantEntries.sort((a, b) => a.placement - b.placement);

    const winnerId =
      finalState.matchWinnerId ??
      finalState.roundWinnerId ??
      participantEntries[0]?.playerId ??
      finalState.players[0]!.id;
    const winnerName =
      finalState.players.find((p) => p.id === winnerId)?.name ?? 'Winner';

    const entry: MatchHistoryEntry = {
      matchId: matchLog.matchId,
      roomCode: matchLog.roomCode,
      seed: matchLog.seed,
      winnerId,
      winnerName,
      roundsPlayed: finalState.roundNumber,
      actionCount: matchLog.actions.length,
      targetScore: matchLog.targetScore,
      startedAt: matchLog.startedAt,
      completedAt: now,
      participants: participantEntries,
    };

    this.matches.set(entry.matchId, entry);
    return entry;
  }

  public async getLeaderboard(limit = 20): Promise<AccountProfile[]> {
    const all = Array.from(this.accounts.values());
    all.sort((a, b) => {
      if (b.rating.displayRating !== a.rating.displayRating) {
        return b.rating.displayRating - a.rating.displayRating;
      }
      if (b.matchesWon !== a.matchesWon) {
        return b.matchesWon - a.matchesWon;
      }
      return b.totalPoints - a.totalPoints;
    });
    return all.slice(0, limit);
  }

  public async getRecentMatches(
    limit = 15,
    playerId?: string
  ): Promise<MatchHistoryEntry[]> {
    let list = Array.from(this.matches.values());
    if (playerId) {
      list = list.filter((m) =>
        m.participants.some((p) => p.playerId === playerId)
      );
    }
    list.sort((a, b) => b.completedAt - a.completedAt);
    return list.slice(0, limit);
  }

  public async getMatchHistoryEntry(
    matchId: string
  ): Promise<MatchHistoryEntry | null> {
    return this.matches.get(matchId) ?? null;
  }

  public async close(): Promise<void> {
    this.accounts.clear();
    this.matches.clear();
  }
}

export class PostgresAccountRepository implements AccountRepository {
  public readonly backend = 'postgres' as const;
  private readonly pool: pg.Pool;
  private readonly db: ReturnType<typeof drizzle>;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
    this.db = drizzle(this.pool);
  }

  private mapRowToProfile(row: typeof usersTable.$inferSelect): AccountProfile {
    return {
      playerId: row.id,
      name: row.name,
      email: row.email ?? null,
      isGuest: row.isGuest,
      rating: {
        mu: row.mu,
        sigma: row.sigma,
        ordinal: row.ordinal,
        displayRating: row.displayRating,
      },
      matchesPlayed: row.matchesPlayed,
      matchesWon: row.matchesWon,
      totalPoints: row.totalPoints,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  public async upsertAccount(input: UpsertAccountInput): Promise<AccountProfile> {
    const now = Date.now();
    const existingRows = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, input.playerId))
      .limit(1);

    const existing = existingRows[0];
    const normalizedEmail =
      typeof input.email === 'string' && input.email.trim().length > 0
        ? input.email.trim().toLowerCase()
        : existing?.email ?? null;
    const isGuest =
      typeof input.isGuest === 'boolean'
        ? input.isGuest
        : normalizedEmail === null;

    if (existing) {
      await this.db
        .update(usersTable)
        .set({
          name: input.name.trim() || existing.name,
          email: normalizedEmail,
          isGuest,
          updatedAt: now,
        })
        .where(eq(usersTable.id, input.playerId));

      return {
        ...this.mapRowToProfile(existing),
        name: input.name.trim() || existing.name,
        email: normalizedEmail,
        isGuest,
        updatedAt: now,
      };
    }

    const defaultRating = buildOpenSkillRating();
    const newRow: typeof usersTable.$inferInsert = {
      id: input.playerId,
      name: input.name.trim() || 'Player',
      email: normalizedEmail,
      isGuest,
      mu: defaultRating.mu,
      sigma: defaultRating.sigma,
      ordinal: defaultRating.ordinal,
      displayRating: defaultRating.displayRating,
      matchesPlayed: 0,
      matchesWon: 0,
      totalPoints: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(usersTable).values(newRow);
    return {
      playerId: newRow.id,
      name: newRow.name,
      email: normalizedEmail,
      isGuest,
      rating: defaultRating,
      matchesPlayed: 0,
      matchesWon: 0,
      totalPoints: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async getAccount(playerId: string): Promise<AccountProfile | null> {
    const rows = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, playerId))
      .limit(1);
    return rows[0] ? this.mapRowToProfile(rows[0]) : null;
  }

  public async findAccountByEmail(email: string): Promise<AccountProfile | null> {
    const rows = await this.db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.trim().toLowerCase()))
      .limit(1);
    return rows[0] ? this.mapRowToProfile(rows[0]) : null;
  }

  public async recordCompletedMatchFromLog(
    params: RecordMatchFromLogParams
  ): Promise<MatchHistoryEntry> {
    const { matchLog, finalState, playerMeta } = params;
    const now = Date.now();
    const placements = computePlacements(finalState);

    const currentProfiles = new Map<string, AccountProfile>();
    for (const p of finalState.players) {
      const meta = playerMeta?.[p.id];
      const profile = await this.upsertAccount({
        playerId: p.id,
        name: p.name,
        email: meta?.email,
        isGuest: meta?.isGuest,
      });
      currentProfiles.set(p.id, profile);
    }

    const ratingUpdates = updateOpenSkillRatings(
      finalState.players.map((p) => ({
        playerId: p.id,
        rating: currentProfiles.get(p.id)!.rating,
        placement: placements.get(p.id) ?? 2,
      }))
    );
    const updateByPlayer = new Map(
      ratingUpdates.map((u) => [u.playerId, u])
    );

    const participantEntries: MatchHistoryParticipant[] = [];
    for (const p of finalState.players) {
      const profile = currentProfiles.get(p.id)!;
      const update = updateByPlayer.get(p.id)!;
      const placement = placements.get(p.id) ?? 2;
      const won = placement === 1;

      await this.db
        .update(usersTable)
        .set({
          mu: update.after.mu,
          sigma: update.after.sigma,
          ordinal: update.after.ordinal,
          displayRating: update.after.displayRating,
          matchesPlayed: profile.matchesPlayed + 1,
          matchesWon: profile.matchesWon + (won ? 1 : 0),
          totalPoints: profile.totalPoints + p.score,
          updatedAt: now,
        })
        .where(eq(usersTable.id, p.id));

      participantEntries.push({
        playerId: p.id,
        name: p.name,
        isGuest: profile.isGuest,
        placement,
        finalScore: p.score,
        ratingBefore: update.before.displayRating,
        ratingAfter: update.after.displayRating,
        ratingDelta: update.ratingDelta,
      });
    }

    participantEntries.sort((a, b) => a.placement - b.placement);

    const winnerId =
      finalState.matchWinnerId ??
      finalState.roundWinnerId ??
      participantEntries[0]?.playerId ??
      finalState.players[0]!.id;
    const winnerName =
      finalState.players.find((p) => p.id === winnerId)?.name ?? 'Winner';

    await this.db.insert(matchesTable).values({
      matchId: matchLog.matchId,
      roomCode: matchLog.roomCode,
      seed: matchLog.seed,
      winnerId,
      winnerName,
      roundsPlayed: finalState.roundNumber,
      actionCount: matchLog.actions.length,
      targetScore: matchLog.targetScore,
      houseRulesJson: matchLog.houseRules,
      startedAt: matchLog.startedAt,
      completedAt: now,
    });

    for (const p of finalState.players) {
      const profile = currentProfiles.get(p.id)!;
      const update = updateByPlayer.get(p.id)!;
      const placement = placements.get(p.id) ?? 2;
      await this.db.insert(matchParticipantsTable).values({
        matchId: matchLog.matchId,
        playerId: p.id,
        name: p.name,
        isGuest: profile.isGuest,
        placement,
        finalScore: p.score,
        muBefore: update.before.mu,
        sigmaBefore: update.before.sigma,
        muAfter: update.after.mu,
        sigmaAfter: update.after.sigma,
        ratingBefore: update.before.displayRating,
        ratingAfter: update.after.displayRating,
        ratingDelta: update.ratingDelta,
      });
    }

    return {
      matchId: matchLog.matchId,
      roomCode: matchLog.roomCode,
      seed: matchLog.seed,
      winnerId,
      winnerName,
      roundsPlayed: finalState.roundNumber,
      actionCount: matchLog.actions.length,
      targetScore: matchLog.targetScore,
      startedAt: matchLog.startedAt,
      completedAt: now,
      participants: participantEntries,
    };
  }

  public async getLeaderboard(limit = 20): Promise<AccountProfile[]> {
    const rows = await this.db
      .select()
      .from(usersTable)
      .orderBy(desc(usersTable.displayRating), desc(usersTable.matchesWon))
      .limit(limit);
    return rows.map((r) => this.mapRowToProfile(r));
  }

  public async getRecentMatches(
    limit = 15,
    playerId?: string
  ): Promise<MatchHistoryEntry[]> {
    const matchesRows = await this.db
      .select()
      .from(matchesTable)
      .orderBy(desc(matchesTable.completedAt))
      .limit(limit);

    const results: MatchHistoryEntry[] = [];
    for (const m of matchesRows) {
      const partRows = await this.db
        .select()
        .from(matchParticipantsTable)
        .where(eq(matchParticipantsTable.matchId, m.matchId));

      if (playerId && !partRows.some((p) => p.playerId === playerId)) {
        continue;
      }

      partRows.sort((a, b) => a.placement - b.placement);
      results.push({
        matchId: m.matchId,
        roomCode: m.roomCode,
        seed: m.seed,
        winnerId: m.winnerId,
        winnerName: m.winnerName,
        roundsPlayed: m.roundsPlayed,
        actionCount: m.actionCount,
        targetScore: m.targetScore,
        startedAt: m.startedAt,
        completedAt: m.completedAt,
        participants: partRows.map((p) => ({
          playerId: p.playerId,
          name: p.name,
          isGuest: p.isGuest,
          placement: p.placement,
          finalScore: p.finalScore,
          ratingBefore: p.ratingBefore,
          ratingAfter: p.ratingAfter,
          ratingDelta: p.ratingDelta,
        })),
      });
    }
    return results;
  }

  public async getMatchHistoryEntry(
    matchId: string
  ): Promise<MatchHistoryEntry | null> {
    const matchRows = await this.db
      .select()
      .from(matchesTable)
      .where(eq(matchesTable.matchId, matchId))
      .limit(1);

    const m = matchRows[0];
    if (!m) return null;

    const partRows = await this.db
      .select()
      .from(matchParticipantsTable)
      .where(eq(matchParticipantsTable.matchId, m.matchId));

    partRows.sort((a, b) => a.placement - b.placement);
    return {
      matchId: m.matchId,
      roomCode: m.roomCode,
      seed: m.seed,
      winnerId: m.winnerId,
      winnerName: m.winnerName,
      roundsPlayed: m.roundsPlayed,
      actionCount: m.actionCount,
      targetScore: m.targetScore,
      startedAt: m.startedAt,
      completedAt: m.completedAt,
      participants: partRows.map((p) => ({
        playerId: p.playerId,
        name: p.name,
        isGuest: p.isGuest,
        placement: p.placement,
        finalScore: p.finalScore,
        ratingBefore: p.ratingBefore,
        ratingAfter: p.ratingAfter,
        ratingDelta: p.ratingDelta,
      })),
    };
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createAccountRepository(
  databaseUrl = process.env.DATABASE_URL
): AccountRepository {
  if (databaseUrl && databaseUrl.trim().length > 0) {
    return new PostgresAccountRepository(databaseUrl.trim());
  }
  return new InMemoryAccountRepository();
}

const globalForAccountRepo = globalThis as unknown as {
  __cardclashAccountRepo?: AccountRepository;
};

export function getSharedAccountRepository(): AccountRepository {
  if (!globalForAccountRepo.__cardclashAccountRepo) {
    globalForAccountRepo.__cardclashAccountRepo = createAccountRepository();
  }
  return globalForAccountRepo.__cardclashAccountRepo;
}

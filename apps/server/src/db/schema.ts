import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
} from 'drizzle-orm/pg-core';
import type { HouseRules } from '@cardclash/engine';

export const usersTable = pgTable('cardclash_users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email'),
  isGuest: boolean('is_guest').notNull().default(true),
  mu: doublePrecision('mu').notNull().default(25.0),
  sigma: doublePrecision('sigma').notNull().default(8.3333),
  ordinal: doublePrecision('ordinal').notNull().default(0.0),
  displayRating: integer('display_rating').notNull().default(1000),
  matchesPlayed: integer('matches_played').notNull().default(0),
  matchesWon: integer('matches_won').notNull().default(0),
  totalPoints: integer('total_points').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const matchesTable = pgTable('cardclash_matches', {
  matchId: text('match_id').primaryKey(),
  roomCode: text('room_code').notNull(),
  seed: text('seed').notNull(),
  winnerId: text('winner_id').notNull(),
  winnerName: text('winner_name').notNull(),
  roundsPlayed: integer('rounds_played').notNull(),
  actionCount: integer('action_count').notNull(),
  targetScore: integer('target_score').notNull(),
  houseRulesJson: jsonb('house_rules_json').$type<HouseRules>().notNull(),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }).notNull(),
});

export const matchParticipantsTable = pgTable('cardclash_match_participants', {
  id: serial('id').primaryKey(),
  matchId: text('match_id')
    .notNull()
    .references(() => matchesTable.matchId, { onDelete: 'cascade' }),
  playerId: text('player_id').notNull(),
  name: text('name').notNull(),
  isGuest: boolean('is_guest').notNull().default(true),
  placement: integer('placement').notNull(),
  finalScore: integer('final_score').notNull(),
  muBefore: doublePrecision('mu_before').notNull(),
  sigmaBefore: doublePrecision('sigma_before').notNull(),
  muAfter: doublePrecision('mu_after').notNull(),
  sigmaAfter: doublePrecision('sigma_after').notNull(),
  ratingBefore: integer('rating_before').notNull(),
  ratingAfter: integer('rating_after').notNull(),
  ratingDelta: integer('rating_delta').notNull(),
});

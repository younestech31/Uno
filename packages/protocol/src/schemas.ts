import { z } from 'zod';
import type { GameEvent, HouseRules, PlayerView } from '@cardclash/engine';

export const ColoredCardColorSchema = z.enum(['RED', 'YELLOW', 'GREEN', 'BLUE']);

export const GameModeSchema = z.enum(['CLASSIC', 'NO_MERCY']);

export const HouseRulesPartialSchema = z
  .object({
    gameMode: GameModeSchema.optional(),
    stacking: z.boolean().optional(),
    sevenZeroSwap: z.boolean().optional(),
    jumpIn: z.boolean().optional(),
    wildDrawFourChallenge: z.boolean().optional(),
  })
  .strict();

export const HouseRulesSchema = z
  .object({
    gameMode: GameModeSchema.optional(),
    stacking: z.boolean(),
    sevenZeroSwap: z.boolean(),
    jumpIn: z.boolean(),
    wildDrawFourChallenge: z.boolean(),
  })
  .strict();

export const RoomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{4}$/, 'Room code must be 4 uppercase alphanumeric characters');

export const RoomCreateIntentSchema = z
  .object({
    houseRules: HouseRulesPartialSchema.optional(),
    targetScore: z.number().int().min(50).max(5000).optional(),
    maxPlayers: z.number().int().min(2).max(10).optional(),
  })
  .strict()
  .optional();

export type RoomCreateIntent = z.infer<typeof RoomCreateIntentSchema>;

export const RoomJoinIntentSchema = z
  .object({
    roomCode: RoomCodeSchema,
  })
  .strict();

export type RoomJoinIntent = z.infer<typeof RoomJoinIntentSchema>;

export const RoomSpectateIntentSchema = z
  .object({
    roomCode: RoomCodeSchema,
  })
  .strict();

export type RoomSpectateIntent = z.infer<typeof RoomSpectateIntentSchema>;

export const RoomLeaveIntentSchema = z
  .object({
    roomCode: RoomCodeSchema.optional(),
    companionPlayerIds: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

export type RoomLeaveIntent = z.infer<typeof RoomLeaveIntentSchema>;

export const RoomReadyIntentSchema = z
  .object({
    roomCode: RoomCodeSchema.optional(),
    ready: z.boolean(),
  })
  .strict();

export type RoomReadyIntent = z.infer<typeof RoomReadyIntentSchema>;

export const RoomStartIntentSchema = z
  .object({
    roomCode: RoomCodeSchema.optional(),
  })
  .strict()
  .optional();

export type RoomStartIntent = z.infer<typeof RoomStartIntentSchema>;

export const RoomRematchIntentSchema = z
  .object({
    roomCode: RoomCodeSchema.optional(),
  })
  .strict()
  .optional();

export type RoomRematchIntent = z.infer<typeof RoomRematchIntentSchema>;

export const SessionHeartbeatIntentSchema = z
  .object({
    clientTime: z.number().optional(),
  })
  .strict()
  .optional();

export type SessionHeartbeatIntent = z.infer<typeof SessionHeartbeatIntentSchema>;

export const ChatSendIntentSchema = z
  .object({
    roomCode: RoomCodeSchema.optional(),
    text: z.string().max(240).optional(),
    emoji: z.string().max(16).optional(),
  })
  .strict();

export type ChatSendIntent = z.infer<typeof ChatSendIntentSchema>;

export const ChatReportIntentSchema = z
  .object({
    roomCode: RoomCodeSchema.optional(),
    messageId: z.string().min(1),
    reason: z.string().min(1).max(120).optional(),
  })
  .strict();

export type ChatReportIntent = z.infer<typeof ChatReportIntentSchema>;

const SeqSchema = z.number().int().min(1);
const OptionalPlayerIdSchema = z.string().min(1).optional();

export const ChooseInitialColorIntentSchema = z
  .object({
    type: z.literal('CHOOSE_INITIAL_COLOR'),
    color: ColoredCardColorSchema,
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const ChooseRouletteColorIntentSchema = z
  .object({
    type: z.literal('CHOOSE_ROULETTE_COLOR'),
    color: ColoredCardColorSchema,
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const PlayCardIntentSchema = z
  .object({
    type: z.literal('PLAY_CARD'),
    cardId: z.string().min(1),
    chosenColor: ColoredCardColorSchema.optional(),
    callUno: z.boolean().optional(),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const DrawCardIntentSchema = z
  .object({
    type: z.literal('DRAW_CARD'),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const PassTurnIntentSchema = z
  .object({
    type: z.literal('PASS_TURN'),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const CallUnoIntentSchema = z
  .object({
    type: z.literal('CALL_UNO'),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const CatchUnoIntentSchema = z
  .object({
    type: z.literal('CATCH_UNO'),
    targetPlayerId: z.string().min(1).optional(),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const ChooseSwapTargetIntentSchema = z
  .object({
    type: z.literal('CHOOSE_SWAP_TARGET'),
    targetPlayerId: z.string().min(1),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const ChallengeWildDrawFourIntentSchema = z
  .object({
    type: z.literal('CHALLENGE_WILD_DRAW_FOUR'),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const AcceptWildDrawFourIntentSchema = z
  .object({
    type: z.literal('ACCEPT_WILD_DRAW_FOUR'),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const StartNextRoundIntentSchema = z
  .object({
    type: z.literal('START_NEXT_ROUND'),
    seq: SeqSchema,
    playerId: OptionalPlayerIdSchema,
  })
  .strict();

export const ClientGameActionIntentSchema = z.discriminatedUnion('type', [
  ChooseInitialColorIntentSchema,
  ChooseRouletteColorIntentSchema,
  PlayCardIntentSchema,
  DrawCardIntentSchema,
  PassTurnIntentSchema,
  CallUnoIntentSchema,
  CatchUnoIntentSchema,
  ChooseSwapTargetIntentSchema,
  ChallengeWildDrawFourIntentSchema,
  AcceptWildDrawFourIntentSchema,
  StartNextRoundIntentSchema,
]);

export type ClientGameActionIntent = z.infer<typeof ClientGameActionIntentSchema>;

export type ClientGameActionDraft =
  ClientGameActionIntent extends infer U
    ? U extends ClientGameActionIntent
      ? Omit<U, 'seq'>
      : never
    : never;

export const GameActionEnvelopeSchema = z
  .object({
    roomCode: RoomCodeSchema.optional(),
    action: ClientGameActionIntentSchema,
  })
  .strict();

export type GameActionEnvelope = z.infer<typeof GameActionEnvelopeSchema>;

export type RoomStatus = 'LOBBY' | 'IN_GAME' | 'FINISHED';

export interface RoomMemberView {
  readonly id: string;
  readonly name: string;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly isHost: boolean;
  readonly isBot?: boolean;
  readonly isGuest?: boolean;
  readonly disconnectedAt?: number | null;
}

export interface RoomSpectatorView {
  readonly id: string;
  readonly name: string;
}

export interface PublicRoomState {
  readonly roomCode: string;
  readonly status: RoomStatus;
  readonly hostPlayerId: string;
  readonly players: readonly RoomMemberView[];
  readonly spectators?: readonly RoomSpectatorView[];
  readonly spectatorCount?: number;
  readonly houseRules: HouseRules;
  readonly targetScore: number;
  readonly maxPlayers: number;
  readonly matchId: string | null;
  readonly turnDeadlineAt?: number | null;
}

export type ProtocolErrorCode =
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'CHAT_RATE_LIMITED'
  | 'CHAT_REJECTED'
  | 'VALIDATION_ERROR'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_ALREADY_STARTED'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'PLAYERS_NOT_READY'
  | 'NOT_ENOUGH_PLAYERS'
  | 'IDENTITY_MISMATCH'
  | 'ENGINE_ERROR';

export interface ProtocolErrorPayload {
  readonly code: ProtocolErrorCode | string;
  readonly message: string;
}

export type SocketAckResult<T = undefined> =
  | (T extends undefined
      ? { readonly ok: true }
      : { readonly ok: true; readonly data: T })
  | { readonly ok: false; readonly error: ProtocolErrorPayload };

export interface GameEventsBroadcast {
  readonly roomCode: string;
  readonly matchId: string;
  readonly actorPlayerId: string;
  readonly seq: number;
  readonly events: readonly GameEvent[];
}

export interface GameViewBroadcast {
  readonly roomCode: string;
  readonly view: PlayerView;
  readonly turnDeadlineAt?: number | null;
  readonly isSpectator?: boolean;
}

export interface HeartbeatAckPayload {
  readonly serverTime: number;
  readonly roomCode: string | null;
  readonly turnDeadlineAt: number | null;
}

export interface ChatMessagePayload {
  readonly id: string;
  readonly roomCode: string;
  readonly senderId: string;
  readonly senderName: string;
  readonly isSpectator: boolean;
  readonly text: string;
  readonly emoji?: string | null;
  readonly filtered: boolean;
  readonly timestamp: number;
}

export interface ChatReportRecord {
  readonly id: string;
  readonly roomCode: string;
  readonly messageId: string;
  readonly reportedSenderId: string;
  readonly reporterId: string;
  readonly reason: string;
  readonly timestamp: number;
}

export interface OpenSkillRating {
  readonly mu: number;
  readonly sigma: number;
  readonly ordinal: number;
  readonly displayRating: number;
}

export interface AccountProfile {
  readonly playerId: string;
  readonly name: string;
  readonly email: string | null;
  readonly isGuest: boolean;
  readonly rating: OpenSkillRating;
  readonly matchesPlayed: number;
  readonly matchesWon: number;
  readonly totalPoints: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface MatchHistoryParticipant {
  readonly playerId: string;
  readonly name: string;
  readonly isGuest: boolean;
  readonly placement: number;
  readonly finalScore: number;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly ratingDelta: number;
}

export interface MatchHistoryEntry {
  readonly matchId: string;
  readonly roomCode: string;
  readonly seed: string;
  readonly winnerId: string;
  readonly winnerName: string;
  readonly roundsPlayed: number;
  readonly actionCount: number;
  readonly targetScore: number;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly participants: readonly MatchHistoryParticipant[];
}

export interface LeaderboardResponse {
  readonly leaderboard: readonly AccountProfile[];
  readonly recentMatches: readonly MatchHistoryEntry[];
}

export interface ReplayActionEntry {
  readonly index: number;
  readonly timestamp: number;
  readonly action: ClientGameActionIntent;
  readonly events: readonly GameEvent[];
}

export interface ReplayDataBundle {
  readonly matchId: string;
  readonly roomCode: string;
  readonly seed: string;
  readonly startedAt: number;
  readonly completedAt: number;
  readonly targetScore: number;
  readonly houseRules: HouseRules;
  readonly winnerId?: string | null;
  readonly winnerName?: string | null;
  readonly players: readonly {
    readonly id: string;
    readonly name: string;
    readonly isGuest?: boolean;
  }[];
  readonly actions: readonly ReplayActionEntry[];
}

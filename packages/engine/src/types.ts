export type ColoredCardColor = 'RED' | 'YELLOW' | 'GREEN' | 'BLUE';
export type CardColor = ColoredCardColor | 'WILD';

export type NumberValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type GameMode = 'CLASSIC' | 'NO_MERCY';

export type ColoredActionKind =
  | 'SKIP'
  | 'REVERSE'
  | 'DRAW_TWO'
  | 'DRAW_FOUR'
  | 'SKIP_ALL'
  | 'DISCARD_ALL';

export type WildCardKind =
  | 'WILD'
  | 'WILD_DRAW_FOUR'
  | 'WILD_REVERSE_DRAW_FOUR'
  | 'WILD_DRAW_SIX'
  | 'WILD_DRAW_TEN'
  | 'WILD_COLOR_ROULETTE';

export type CardKind = 'NUMBER' | ColoredActionKind | WildCardKind;

export type DrawPenaltyKind =
  | 'DRAW_TWO'
  | 'DRAW_FOUR'
  | 'WILD_DRAW_FOUR'
  | 'WILD_REVERSE_DRAW_FOUR'
  | 'WILD_DRAW_SIX'
  | 'WILD_DRAW_TEN';

export interface NumberCard {
  readonly id: string;
  readonly color: ColoredCardColor;
  readonly kind: 'NUMBER';
  readonly value: NumberValue;
}

export interface ColoredActionCard {
  readonly id: string;
  readonly color: ColoredCardColor;
  readonly kind: ColoredActionKind;
  readonly value: null;
}

export interface WildCard {
  readonly id: string;
  readonly color: 'WILD';
  readonly kind: WildCardKind;
  readonly value: null;
}

export type Card = NumberCard | ColoredActionCard | WildCard;

export type PlayDirection = 1 | -1;

export interface HouseRules {
  readonly gameMode?: GameMode;
  readonly stacking: boolean;
  readonly sevenZeroSwap: boolean;
  readonly jumpIn: boolean;
  readonly wildDrawFourChallenge: boolean;
}

export const DEFAULT_HOUSE_RULES: HouseRules = {
  gameMode: 'CLASSIC',
  stacking: false,
  sevenZeroSwap: false,
  jumpIn: false,
  wildDrawFourChallenge: false,
};

export const NO_MERCY_HOUSE_RULES: HouseRules = {
  gameMode: 'NO_MERCY',
  stacking: true,
  sevenZeroSwap: true,
  jumpIn: false,
  wildDrawFourChallenge: false,
};

export interface PlayerInput {
  readonly id: string;
  readonly name: string;
}

export interface GameConfig {
  readonly matchId: string;
  readonly seed: string;
  readonly players: readonly PlayerInput[];
  readonly targetScore?: number;
  readonly initialHandSize?: number;
  readonly maxPlayers?: number;
  readonly houseRules?: Partial<HouseRules>;
}

export interface PlayerState {
  readonly id: string;
  readonly name: string;
  readonly hand: readonly Card[];
  readonly score: number;
  readonly calledUno: boolean;
  readonly preCalledUno: boolean;
  readonly connected: boolean;
  readonly eliminated?: boolean;
}

export type TurnPhase =
  | 'AWAITING_INITIAL_WILD_COLOR'
  | 'PLAY_OR_DRAW'
  | 'DRAWN_PLAY_OR_PASS'
  | 'STACK_OR_DRAW'
  | 'AWAITING_SWAP_TARGET'
  | 'AWAITING_WD4_CHALLENGE'
  | 'AWAITING_ROULETTE_COLOR';

export type GameStatus = 'IN_PROGRESS' | 'ROUND_OVER' | 'MATCH_OVER';

export interface PrngState {
  readonly s0: number;
  readonly s1: number;
  readonly s2: number;
  readonly s3: number;
}

export interface Wd4ChallengeState {
  readonly blufferPlayerId: string;
  readonly challengerPlayerId: string;
  readonly previousColor: ColoredCardColor | null;
  readonly wasGuilty: boolean;
}

export interface GameState {
  readonly matchId: string;
  readonly seed: string;
  readonly prngState: PrngState;
  readonly status: GameStatus;
  readonly roundNumber: number;
  readonly players: readonly PlayerState[];
  readonly currentPlayerIndex: number;
  readonly direction: PlayDirection;
  readonly turnPhase: TurnPhase;
  readonly drawPile: readonly Card[];
  readonly discardPile: readonly Card[];
  readonly currentColor: ColoredCardColor | null;
  readonly pendingDrawnCardId: string | null;
  readonly pendingDrawCount: number;
  readonly pendingDrawKind: DrawPenaltyKind | null;
  readonly unoVulnerablePlayerId: string | null;
  readonly wd4ChallengeState: Wd4ChallengeState | null;
  readonly lastSeqByPlayer: Readonly<Record<string, number>>;
  readonly houseRules: HouseRules;
  readonly targetScore: number;
  readonly initialHandSize: number;
  readonly roundWinnerId: string | null;
  readonly matchWinnerId: string | null;
}

export interface BaseClientAction {
  readonly playerId: string;
  readonly seq: number;
}

export interface ChooseInitialColorAction extends BaseClientAction {
  readonly type: 'CHOOSE_INITIAL_COLOR';
  readonly color: ColoredCardColor;
}

export interface ChooseRouletteColorAction extends BaseClientAction {
  readonly type: 'CHOOSE_ROULETTE_COLOR';
  readonly color: ColoredCardColor;
}

export interface PlayCardAction extends BaseClientAction {
  readonly type: 'PLAY_CARD';
  readonly cardId: string;
  readonly chosenColor?: ColoredCardColor;
  readonly callUno?: boolean;
}

export interface DrawCardAction extends BaseClientAction {
  readonly type: 'DRAW_CARD';
}

export interface PassTurnAction extends BaseClientAction {
  readonly type: 'PASS_TURN';
}

export interface CallUnoAction extends BaseClientAction {
  readonly type: 'CALL_UNO';
}

export interface CatchUnoAction extends BaseClientAction {
  readonly type: 'CATCH_UNO';
  readonly targetPlayerId?: string;
}

export interface ChooseSwapTargetAction extends BaseClientAction {
  readonly type: 'CHOOSE_SWAP_TARGET';
  readonly targetPlayerId: string;
}

export interface ChallengeWildDrawFourAction extends BaseClientAction {
  readonly type: 'CHALLENGE_WILD_DRAW_FOUR';
}

export interface AcceptWildDrawFourAction extends BaseClientAction {
  readonly type: 'ACCEPT_WILD_DRAW_FOUR';
}

export interface StartNextRoundAction extends BaseClientAction {
  readonly type: 'START_NEXT_ROUND';
}

export type GameAction =
  | ChooseInitialColorAction
  | ChooseRouletteColorAction
  | PlayCardAction
  | DrawCardAction
  | PassTurnAction
  | CallUnoAction
  | CatchUnoAction
  | ChooseSwapTargetAction
  | ChallengeWildDrawFourAction
  | AcceptWildDrawFourAction
  | StartNextRoundAction;

export type EngineErrorCode =
  | 'INVALID_CONFIG'
  | 'UNKNOWN_PLAYER'
  | 'STALE_SEQUENCE'
  | 'GAME_NOT_IN_PROGRESS'
  | 'ROUND_NOT_OVER'
  | 'NOT_YOUR_TURN'
  | 'INVALID_PHASE_ACTION'
  | 'CARD_NOT_IN_HAND'
  | 'MUST_PLAY_DRAWN_CARD'
  | 'ILLEGAL_PLAY'
  | 'ILLEGAL_WILD_DRAW_FOUR'
  | 'MISSING_WILD_COLOR'
  | 'UNEXPECTED_WILD_COLOR'
  | 'INVALID_UNO_CALL'
  | 'INVALID_CATCH'
  | 'INVALID_SWAP_TARGET';

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
}

export type GameEvent =
  | {
      readonly type: 'ROUND_STARTED';
      readonly roundNumber: number;
      readonly firstCard: Card;
      readonly startingPlayerId: string;
      readonly direction: PlayDirection;
    }
  | {
      readonly type: 'INITIAL_COLOR_CHOSEN';
      readonly playerId: string;
      readonly color: ColoredCardColor;
    }
  | {
      readonly type: 'CARD_PLAYED';
      readonly playerId: string;
      readonly card: Card;
      readonly chosenColor: ColoredCardColor | null;
      readonly jumpedIn: boolean;
    }
  | {
      readonly type: 'DISCARD_ALL_PLAYED';
      readonly playerId: string;
      readonly color: ColoredCardColor;
      readonly count: number;
    }
  | {
      readonly type: 'COLOR_ROULETTE_RESOLVED';
      readonly playerId: string;
      readonly chosenColor: ColoredCardColor;
      readonly drawnCount: number;
    }
  | {
      readonly type: 'PLAYER_ELIMINATED';
      readonly playerId: string;
      readonly cardCount: number;
      readonly bonusAwardedToId: string | null;
      readonly bonusPoints: number;
    }
  | {
      readonly type: 'CARDS_DRAWN';
      readonly playerId: string;
      readonly count: number;
      readonly reason:
        | 'TURN_DRAW'
        | 'DRAW_TWO'
        | 'DRAW_FOUR'
        | 'WILD_DRAW_FOUR'
        | 'WILD_REVERSE_DRAW_FOUR'
        | 'WILD_DRAW_SIX'
        | 'WILD_DRAW_TEN'
        | 'COLOR_ROULETTE'
        | 'UNO_PENALTY'
        | 'CHALLENGE_PENALTY'
        | 'INITIAL_FLIP';
    }
  | {
      readonly type: 'TURN_PASSED';
      readonly playerId: string;
    }
  | {
      readonly type: 'TURN_SKIPPED';
      readonly skippedPlayerId: string;
      readonly reason:
        | 'SKIP_CARD'
        | 'SKIP_ALL'
        | 'REVERSE_TWO_PLAYER'
        | 'DRAW_PENALTY'
        | 'INITIAL_FLIP';
    }
  | {
      readonly type: 'DIRECTION_REVERSED';
      readonly direction: PlayDirection;
    }
  | {
      readonly type: 'DECK_RESHUFFLED';
      readonly newDrawPileCount: number;
    }
  | {
      readonly type: 'UNO_CALLED';
      readonly playerId: string;
    }
  | {
      readonly type: 'UNO_CAUGHT';
      readonly catcherId: string;
      readonly caughtId: string;
      readonly penaltyCount: number;
    }
  | {
      readonly type: 'HANDS_SWAPPED';
      readonly mode: 'SEVEN_TARGET' | 'ZERO_ROTATE';
      readonly sourcePlayerId: string;
      readonly targetPlayerId?: string;
    }
  | {
      readonly type: 'WD4_CHALLENGE_RESOLVED';
      readonly challengerId: string;
      readonly blufferId: string;
      readonly wasGuilty: boolean;
      readonly penalizedPlayerId: string;
      readonly penaltyCount: number;
    }
  | {
      readonly type: 'ROUND_ENDED';
      readonly roundNumber: number;
      readonly winnerId: string;
      readonly pointsEarned: number;
      readonly newScore: number;
    }
  | {
      readonly type: 'MATCH_ENDED';
      readonly winnerId: string;
      readonly finalScores: Readonly<Record<string, number>>;
      readonly seed: string;
    };

export type EngineResult =
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly events: readonly GameEvent[];
    }
  | {
      readonly ok: false;
      readonly error: EngineError;
    };

export interface OpponentView {
  readonly id: string;
  readonly name: string;
  readonly cardCount: number;
  readonly score: number;
  readonly calledUno: boolean;
  readonly connected: boolean;
  readonly eliminated?: boolean;
}

export interface PlayerView {
  readonly matchId: string;
  readonly viewerId: string;
  readonly status: GameStatus;
  readonly roundNumber: number;
  readonly currentPlayerId: string;
  readonly direction: PlayDirection;
  readonly turnPhase: TurnPhase;
  readonly topDiscard: Card;
  readonly discardCount: number;
  readonly drawPileCount: number;
  readonly currentColor: ColoredCardColor | null;
  readonly hand: readonly Card[];
  readonly opponents: readonly OpponentView[];
  readonly pendingDrawnCardId: string | null;
  readonly pendingDrawCount: number;
  readonly pendingDrawKind?: DrawPenaltyKind | null;
  readonly unoVulnerablePlayerId: string | null;
  readonly lastSeq: number;
  readonly houseRules: HouseRules;
  readonly targetScore: number;
  readonly roundWinnerId: string | null;
  readonly matchWinnerId: string | null;
  readonly revealedSeed: string | null;
  readonly eliminated?: boolean;
}

import type {
  Card,
  CardKind,
  ColoredCardColor,
  GameState,
  HouseRules,
  PlayDirection,
  PlayerState,
} from './types';

/**
 * Advances a seat index by `steps` in `direction` modulo `playerCount`.
 */
export function getNextPlayerIndex(
  currentIndex: number,
  direction: PlayDirection,
  playerCount: number,
  steps = 1
): number {
  const offset = (direction * steps) % playerCount;
  return (currentIndex + offset + playerCount) % playerCount;
}

/**
 * Advances a seat index by `steps` active (non-eliminated) players in `direction`.
 */
export function getNextActivePlayerIndex(
  players: readonly Pick<PlayerState, 'eliminated'>[],
  currentIndex: number,
  direction: PlayDirection,
  steps = 1
): number {
  const playerCount = players.length;
  if (playerCount === 0) return 0;
  const activeCount = players.filter((p) => !p.eliminated).length;
  if (activeCount <= 1) {
    const soleActive = players.findIndex((p) => !p.eliminated);
    return soleActive !== -1 ? soleActive : currentIndex;
  }

  let idx = currentIndex;
  let remainingSteps = steps;
  let guard = 0;
  while (remainingSteps > 0 && guard < playerCount * 10) {
    idx = (idx + direction + playerCount) % playerCount;
    if (!players[idx]?.eliminated) {
      remainingSteps--;
    }
    guard++;
  }
  return idx;
}

/**
 * Returns the numeric draw penalty value of a draw card kind (or 0 if not a draw penalty card).
 */
export function getDrawPenaltyValue(kind: CardKind | null | undefined): number {
  switch (kind) {
    case 'DRAW_TWO':
      return 2;
    case 'DRAW_FOUR':
    case 'WILD_DRAW_FOUR':
    case 'WILD_REVERSE_DRAW_FOUR':
      return 4;
    case 'WILD_DRAW_SIX':
      return 6;
    case 'WILD_DRAW_TEN':
      return 10;
    default:
      return 0;
  }
}

/**
 * Checks whether a player's hand contains any card matching `currentColor`.
 * Used to enforce the Wild Draw Four legality rule.
 */
export function hasCardOfCurrentColor(
  hand: readonly Card[],
  currentColor: ColoredCardColor | null,
  excludeCardId?: string
): boolean {
  if (!currentColor) {
    return false;
  }
  return hand.some(
    (card) => card.id !== excludeCardId && card.color === currentColor
  );
}

/**
 * Checks whether a card is an exact match (same color and same rank/symbol)
 * with the top discard card for the `jumpIn` house rule.
 */
export function isExactJumpInMatch(card: Card, topCard: Card): boolean {
  if (card.color === 'WILD' || topCard.color === 'WILD') {
    return false;
  }
  if (card.color !== topCard.color || card.kind !== topCard.kind) {
    return false;
  }
  if (card.kind === 'NUMBER' && topCard.kind === 'NUMBER') {
    return card.value === topCard.value;
  }
  return true;
}

export interface PlayabilityContext {
  readonly topCard: Card;
  readonly currentColor: ColoredCardColor | null;
  readonly hand: readonly Card[];
  readonly houseRules: HouseRules;
  readonly turnPhase?: GameState['turnPhase'];
  readonly pendingDrawnCardId?: string | null;
  readonly pendingDrawCount?: number;
  readonly pendingDrawKind?: GameState['pendingDrawKind'];
}

/**
 * Pure helper to check if `card` can be legally played given the current table context.
 * Can be safely imported by the client for UI highlighting hints.
 */
export function isPlayable(card: Card, ctx: PlayabilityContext): boolean {
  const phase = ctx.turnPhase ?? 'PLAY_OR_DRAW';

  if (
    phase === 'AWAITING_INITIAL_WILD_COLOR' ||
    phase === 'AWAITING_SWAP_TARGET' ||
    phase === 'AWAITING_WD4_CHALLENGE' ||
    phase === 'AWAITING_ROULETTE_COLOR'
  ) {
    return false;
  }

  // If in DRAWN_PLAY_OR_PASS phase, only the just-drawn card may be played
  if (phase === 'DRAWN_PLAY_OR_PASS') {
    if (!ctx.pendingDrawnCardId || card.id !== ctx.pendingDrawnCardId) {
      return false;
    }
  }

  // If stacking penalty is active, check progressive or classic stacking
  const pendingDrawCount = ctx.pendingDrawCount ?? 0;
  if (pendingDrawCount > 0 || phase === 'STACK_OR_DRAW') {
    if (!ctx.houseRules.stacking) {
      return false;
    }
    if (ctx.houseRules.gameMode === 'NO_MERCY') {
      const cardPenalty = getDrawPenaltyValue(card.kind);
      const minPenalty = getDrawPenaltyValue(ctx.pendingDrawKind);
      return cardPenalty > 0 && cardPenalty >= Math.max(2, minPenalty);
    }
    if (ctx.pendingDrawKind === 'DRAW_TWO') {
      return card.kind === 'DRAW_TWO';
    }
    if (ctx.pendingDrawKind === 'WILD_DRAW_FOUR') {
      return card.kind === 'WILD_DRAW_FOUR';
    }
    return false;
  }

  // Standard play legality for Wild cards
  if (
    card.kind === 'WILD' ||
    card.kind === 'WILD_REVERSE_DRAW_FOUR' ||
    card.kind === 'WILD_DRAW_SIX' ||
    card.kind === 'WILD_DRAW_TEN' ||
    card.kind === 'WILD_COLOR_ROULETTE'
  ) {
    return true;
  }

  if (card.kind === 'WILD_DRAW_FOUR') {
    if (ctx.houseRules.gameMode === 'NO_MERCY' || ctx.houseRules.wildDrawFourChallenge) {
      return true;
    }
    return !hasCardOfCurrentColor(ctx.hand, ctx.currentColor, card.id);
  }

  // Colored card (NUMBER, SKIP, REVERSE, DRAW_TWO, DRAW_FOUR, SKIP_ALL, DISCARD_ALL)
  if (ctx.currentColor && card.color === ctx.currentColor) {
    return true;
  }

  if (card.kind === 'NUMBER' && ctx.topCard.kind === 'NUMBER') {
    return card.value === ctx.topCard.value;
  }

  if (card.kind !== 'NUMBER' && card.kind === ctx.topCard.kind) {
    return true;
  }

  return false;
}

/**
 * Convenience helper to check if a card is playable by a specific player in `state`.
 */
export function canPlayerPlayCard(
  state: GameState,
  playerId: string,
  cardId: string
): boolean {
  if (state.status !== 'IN_PROGRESS') {
    return false;
  }
  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    return false;
  }
  const player = state.players[playerIndex]!;
  if (player.eliminated) {
    return false;
  }
  const card = player.hand.find((c) => c.id === cardId);
  if (!card) {
    return false;
  }
  const topCard = state.discardPile[state.discardPile.length - 1];
  if (!topCard) {
    return false;
  }

  const isCurrentTurn = playerIndex === state.currentPlayerIndex;
  if (!isCurrentTurn) {
    if (
      state.houseRules.jumpIn &&
      state.turnPhase === 'PLAY_OR_DRAW' &&
      state.pendingDrawCount === 0
    ) {
      return isExactJumpInMatch(card, topCard);
    }
    return false;
  }

  return isPlayable(card, {
    topCard,
    currentColor: state.currentColor,
    hand: player.hand,
    houseRules: state.houseRules,
    turnPhase: state.turnPhase,
    pendingDrawnCardId: state.pendingDrawnCardId,
    pendingDrawCount: state.pendingDrawCount,
    pendingDrawKind: state.pendingDrawKind,
  });
}

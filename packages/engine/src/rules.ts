import type {
  Card,
  ColoredCardColor,
  GameState,
  HouseRules,
  PlayDirection,
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
    phase === 'AWAITING_WD4_CHALLENGE'
  ) {
    return false;
  }

  // If in DRAWN_PLAY_OR_PASS phase, only the just-drawn card may be played
  if (phase === 'DRAWN_PLAY_OR_PASS') {
    if (!ctx.pendingDrawnCardId || card.id !== ctx.pendingDrawnCardId) {
      return false;
    }
  }

  // If stacking penalty is active, only matching draw cards can stack
  const pendingDrawCount = ctx.pendingDrawCount ?? 0;
  if (pendingDrawCount > 0 || phase === 'STACK_OR_DRAW') {
    if (!ctx.houseRules.stacking) {
      return false;
    }
    if (ctx.pendingDrawKind === 'DRAW_TWO') {
      return card.kind === 'DRAW_TWO';
    }
    if (ctx.pendingDrawKind === 'WILD_DRAW_FOUR') {
      return card.kind === 'WILD_DRAW_FOUR';
    }
    return false;
  }

  // Standard play legality
  if (card.kind === 'WILD') {
    return true;
  }

  if (card.kind === 'WILD_DRAW_FOUR') {
    if (ctx.houseRules.wildDrawFourChallenge) {
      return true;
    }
    return !hasCardOfCurrentColor(ctx.hand, ctx.currentColor, card.id);
  }

  // Colored card (NUMBER, SKIP, REVERSE, DRAW_TWO)
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

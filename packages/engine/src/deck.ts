import type { Card, ColoredCardColor, NumberValue } from './types';

export const COLORED_SUITS: readonly ColoredCardColor[] = [
  'RED',
  'YELLOW',
  'GREEN',
  'BLUE',
];

const ONE_TO_NINE: readonly NumberValue[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Creates a standard 108-card UNO-style deck:
 * - Per color (RED, YELLOW, GREEN, BLUE):
 *   - 1x 0 (4 cards)
 *   - 2x 1..9 (72 cards)
 *   - 2x SKIP (8 cards)
 *   - 2x REVERSE (8 cards)
 *   - 2x DRAW_TWO (8 cards)
 * - Wilds:
 *   - 4x WILD (4 cards)
 *   - 4x WILD_DRAW_FOUR (4 cards)
 * Total: 108 uniquely identified cards.
 */
export function createStandardDeck(): Card[] {
  const deck: Card[] = [];

  for (const color of COLORED_SUITS) {
    // Single 0 per color
    deck.push({
      id: `${color}-0-1`,
      color,
      kind: 'NUMBER',
      value: 0,
    });

    // Two of each 1-9 per color
    for (const num of ONE_TO_NINE) {
      for (const copy of [1, 2] as const) {
        deck.push({
          id: `${color}-${num}-${copy}`,
          color,
          kind: 'NUMBER',
          value: num,
        });
      }
    }

    // Two of each action card per color
    for (const kind of ['SKIP', 'REVERSE', 'DRAW_TWO'] as const) {
      for (const copy of [1, 2] as const) {
        deck.push({
          id: `${color}-${kind}-${copy}`,
          color,
          kind,
          value: null,
        });
      }
    }
  }

  // Four Wild and Four Wild Draw Four
  for (const copy of [1, 2, 3, 4] as const) {
    deck.push({
      id: `WILD-${copy}`,
      color: 'WILD',
      kind: 'WILD',
      value: null,
    });
    deck.push({
      id: `WILD_DRAW_FOUR-${copy}`,
      color: 'WILD',
      kind: 'WILD_DRAW_FOUR',
      value: null,
    });
  }

  return deck;
}

export const MERCY_CARD_LIMIT = 25;
export const KNOCKOUT_BONUS_POINTS = 250;

/**
 * Creates a full 168-card UNO Show 'Em No Mercy deck:
 * - Per color (RED, YELLOW, GREEN, BLUE):
 *   - 2x 0..9 (80 number cards)
 *   - 3x SKIP (12 cards)
 *   - 3x REVERSE (12 cards)
 *   - 2x DRAW_TWO (8 cards)
 *   - 2x DRAW_FOUR (8 cards)
 *   - 2x SKIP_ALL (8 cards)
 *   - 3x DISCARD_ALL (12 cards)
 * - Wilds (28 cards):
 *   - 4x WILD
 *   - 8x WILD_REVERSE_DRAW_FOUR
 *   - 4x WILD_DRAW_SIX
 *   - 4x WILD_DRAW_TEN
 *   - 8x WILD_COLOR_ROULETTE
 * Total: 168 uniquely identified cards.
 */
export function createNoMercyDeck(): Card[] {
  const deck: Card[] = [];

  for (const color of COLORED_SUITS) {
    // Two of each 0-9 per color
    for (const num of [0, ...ONE_TO_NINE] as const) {
      for (const copy of [1, 2] as const) {
        deck.push({
          id: `${color}-${num}-${copy}`,
          color,
          kind: 'NUMBER',
          value: num,
        });
      }
    }

    // 3x SKIP, 3x REVERSE, 3x DISCARD_ALL per color
    for (const kind of ['SKIP', 'REVERSE', 'DISCARD_ALL'] as const) {
      for (const copy of [1, 2, 3] as const) {
        deck.push({
          id: `${color}-${kind}-${copy}`,
          color,
          kind,
          value: null,
        });
      }
    }

    // 2x DRAW_TWO, 2x DRAW_FOUR, 2x SKIP_ALL per color
    for (const kind of ['DRAW_TWO', 'DRAW_FOUR', 'SKIP_ALL'] as const) {
      for (const copy of [1, 2] as const) {
        deck.push({
          id: `${color}-${kind}-${copy}`,
          color,
          kind,
          value: null,
        });
      }
    }
  }

  // 4x WILD, 4x WILD_DRAW_SIX, 4x WILD_DRAW_TEN
  for (const copy of [1, 2, 3, 4] as const) {
    deck.push({
      id: `WILD-${copy}`,
      color: 'WILD',
      kind: 'WILD',
      value: null,
    });
    deck.push({
      id: `WILD_DRAW_SIX-${copy}`,
      color: 'WILD',
      kind: 'WILD_DRAW_SIX',
      value: null,
    });
    deck.push({
      id: `WILD_DRAW_TEN-${copy}`,
      color: 'WILD',
      kind: 'WILD_DRAW_TEN',
      value: null,
    });
  }

  // 8x WILD_REVERSE_DRAW_FOUR, 8x WILD_COLOR_ROULETTE
  for (const copy of [1, 2, 3, 4, 5, 6, 7, 8] as const) {
    deck.push({
      id: `WILD_REVERSE_DRAW_FOUR-${copy}`,
      color: 'WILD',
      kind: 'WILD_REVERSE_DRAW_FOUR',
      value: null,
    });
    deck.push({
      id: `WILD_COLOR_ROULETTE-${copy}`,
      color: 'WILD',
      kind: 'WILD_COLOR_ROULETTE',
      value: null,
    });
  }

  return deck;
}

/**
 * Returns the scoring point value of a single card:
 * - Number cards (0-9): face value
 * - Skip / Reverse / Draw Two / Draw Four: 20 points
 * - Skip Everyone / Discard All: 30 points
 * - All Wild cards: 50 points
 */
export function getCardPoints(card: Card): number {
  switch (card.kind) {
    case 'NUMBER':
      return card.value;
    case 'SKIP':
    case 'REVERSE':
    case 'DRAW_TWO':
    case 'DRAW_FOUR':
      return 20;
    case 'SKIP_ALL':
    case 'DISCARD_ALL':
      return 30;
    case 'WILD':
    case 'WILD_DRAW_FOUR':
    case 'WILD_REVERSE_DRAW_FOUR':
    case 'WILD_DRAW_SIX':
    case 'WILD_DRAW_TEN':
    case 'WILD_COLOR_ROULETTE':
      return 50;
  }
}

/**
 * Sums the point values of a collection of cards.
 */
export function calculateHandPoints(cards: readonly Card[]): number {
  let total = 0;
  for (const card of cards) {
    total += getCardPoints(card);
  }
  return total;
}

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

/**
 * Returns the scoring point value of a single card:
 * - Number cards (0-9): face value
 * - Skip / Reverse / Draw Two: 20 points
 * - Wild / Wild Draw Four: 50 points
 */
export function getCardPoints(card: Card): number {
  switch (card.kind) {
    case 'NUMBER':
      return card.value;
    case 'SKIP':
    case 'REVERSE':
    case 'DRAW_TWO':
      return 20;
    case 'WILD':
    case 'WILD_DRAW_FOUR':
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

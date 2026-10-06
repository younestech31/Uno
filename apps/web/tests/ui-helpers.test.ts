import { describe, expect, it } from 'vitest';
import {
  SUIT_META,
  getCardAccessibleName,
  getCardRankLabel,
} from '../../../lib/card-meta';
import { createStandardDeck } from '@cardclash/engine';

describe('Phase 3 — Original Colorblind-Safe Card Art & Accessibility Helpers', () => {
  it('defines distinct colorblind-safe geometric symbols and labels for all 4 colored suits', () => {
    const symbols = new Set([
      SUIT_META.RED.symbol,
      SUIT_META.BLUE.symbol,
      SUIT_META.YELLOW.symbol,
      SUIT_META.GREEN.symbol,
    ]);
    expect(symbols.size).toBe(4);
    expect(SUIT_META.RED.symbol).toBe('▲');
    expect(SUIT_META.BLUE.symbol).toBe('◆');
    expect(SUIT_META.YELLOW.symbol).toBe('●');
    expect(SUIT_META.GREEN.symbol).toBe('★');
  });

  it('produces non-empty rank labels and accessible names for all 108 cards in the deck', () => {
    const deck = createStandardDeck();
    for (const card of deck) {
      const rank = getCardRankLabel(card);
      const accessible = getCardAccessibleName(card);
      expect(rank.length).toBeGreaterThan(0);
      expect(accessible.length).toBeGreaterThan(3);
    }
  });
});

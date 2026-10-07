import type { Card, ColoredCardColor } from '@cardclash/engine';

export interface SuitMeta {
  readonly label: string;
  readonly symbol: string;
  readonly bgClass: string;
  readonly borderClass: string;
  readonly accentClass: string;
  readonly textClass: string;
  readonly hex: string;
}

export const SUIT_META: Record<ColoredCardColor, SuitMeta> = {
  RED: {
    label: 'Crimson',
    symbol: '▲',
    bgClass: 'bg-rose-600',
    borderClass: 'border-rose-400/70',
    accentClass: 'bg-rose-700',
    textClass: 'text-rose-600',
    hex: '#E11D48',
  },
  BLUE: {
    label: 'Cobalt',
    symbol: '◆',
    bgClass: 'bg-blue-600',
    borderClass: 'border-blue-400/70',
    accentClass: 'bg-blue-700',
    textClass: 'text-blue-600',
    hex: '#2563EB',
  },
  YELLOW: {
    label: 'Amber',
    symbol: '●',
    bgClass: 'bg-amber-500',
    borderClass: 'border-amber-300/80',
    accentClass: 'bg-amber-600',
    textClass: 'text-amber-600',
    hex: '#D97706',
  },
  GREEN: {
    label: 'Emerald',
    symbol: '★',
    bgClass: 'bg-emerald-600',
    borderClass: 'border-emerald-400/70',
    accentClass: 'bg-emerald-700',
    textClass: 'text-emerald-600',
    hex: '#059669',
  },
};

export function getCardRankLabel(card: Card): string {
  switch (card.kind) {
    case 'NUMBER':
      return String(card.value);
    case 'SKIP':
      return '⊘';
    case 'SKIP_ALL':
      return '⊘∀';
    case 'REVERSE':
      return '⇄';
    case 'DRAW_TWO':
      return '+2';
    case 'DRAW_FOUR':
      return '+4';
    case 'DISCARD_ALL':
      return '⇊';
    case 'WILD':
      return '✦';
    case 'WILD_DRAW_FOUR':
      return '+4';
    case 'WILD_REVERSE_DRAW_FOUR':
      return '⇄+4';
    case 'WILD_DRAW_SIX':
      return '+6';
    case 'WILD_DRAW_TEN':
      return '+10';
    case 'WILD_COLOR_ROULETTE':
      return '◎';
  }
}

export function getCardAccessibleName(card: Card): string {
  const suitName =
    card.color === 'WILD'
      ? 'Wild'
      : `${SUIT_META[card.color].label} (${card.color})`;
  switch (card.kind) {
    case 'NUMBER':
      return `${suitName} ${card.value}`;
    case 'SKIP':
      return `${suitName} Skip`;
    case 'SKIP_ALL':
      return `${suitName} Skip Everyone`;
    case 'REVERSE':
      return `${suitName} Reverse`;
    case 'DRAW_TWO':
      return `${suitName} Draw Two (+2)`;
    case 'DRAW_FOUR':
      return `${suitName} Draw Four (+4)`;
    case 'DISCARD_ALL':
      return `${suitName} Discard All`;
    case 'WILD':
      return 'Wild Prism';
    case 'WILD_DRAW_FOUR':
      return 'Wild Draw Four (+4)';
    case 'WILD_REVERSE_DRAW_FOUR':
      return 'Wild Reverse Draw Four (⇄+4)';
    case 'WILD_DRAW_SIX':
      return 'Wild Draw Six (+6)';
    case 'WILD_DRAW_TEN':
      return 'Wild Draw Ten (+10)';
    case 'WILD_COLOR_ROULETTE':
      return 'Wild Color Roulette';
  }
}

'use client';

import React from 'react';
import { motion } from 'motion/react';
import type { Card, ColoredCardColor } from '@cardclash/engine';
import {
  SUIT_META,
  getCardAccessibleName,
  getCardRankLabel,
  type SuitMeta,
} from '@/lib/card-meta';

export { SUIT_META, getCardAccessibleName, getCardRankLabel, type SuitMeta };

export function SuitGeometricSvg({
  color,
  className = 'w-4 h-4',
}: {
  color: ColoredCardColor | 'WILD';
  className?: string;
}) {
  if (color === 'RED') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <polygon points="12,3 22,20 2,20" />
      </svg>
    );
  }
  if (color === 'BLUE') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <polygon points="12,2 22,12 12,22 2,12" />
      </svg>
    );
  }
  if (color === 'YELLOW') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }
  if (color === 'GREEN') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
        <polygon points="12,2 15,9 22,12 15,15 12,22 9,15 2,12 9,9" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon points="12,2 19,12 12,12" fill="#E11D48" />
      <polygon points="12,2 12,12 5,12" fill="#2563EB" />
      <polygon points="5,12 12,12 12,22" fill="#D97706" />
      <polygon points="12,12 19,12 12,22" fill="#059669" />
    </svg>
  );
}

export interface CardGraphicProps {
  readonly card: Card;
  readonly playable?: boolean;
  readonly dimmed?: boolean;
  readonly selected?: boolean;
  readonly size?: 'sm' | 'md' | 'lg';
  readonly onClick?: () => void;
}

const SIZE_CLASSES = {
  sm: 'w-16 h-24 rounded-lg p-1.5',
  md: 'w-20 h-30 sm:w-24 sm:h-36 rounded-xl p-2',
  lg: 'w-24 h-36 sm:w-28 sm:h-42 rounded-2xl p-2.5',
} as const;

export function CardGraphic({
  card,
  playable = false,
  dimmed = false,
  selected = false,
  size = 'md',
  onClick,
}: CardGraphicProps) {
  const isWild = card.color === 'WILD';
  const suit = isWild ? null : SUIT_META[card.color];
  const rank = getCardRankLabel(card);
  const ariaLabel = getCardAccessibleName(card);

  const containerBg = isWild ? 'bg-slate-900' : suit!.bgClass;
  const containerBorder = playable
    ? 'border-2 border-white shadow-lg ring-2 ring-emerald-300/80'
    : isWild
      ? 'border border-slate-600/80 shadow-md'
      : `border ${suit!.borderClass} shadow-md`;

  const Component = onClick ? motion.button : motion.div;

  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={ariaLabel}
      whileHover={
        onClick && playable
          ? { y: -10, scale: 1.04 }
          : onClick
            ? { y: -3 }
            : undefined
      }
      whileTap={onClick && playable ? { scale: 0.97 } : undefined}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className={`relative select-none flex flex-col justify-between overflow-hidden text-white transition-opacity ${SIZE_CLASSES[size]} ${containerBg} ${containerBorder} ${
        dimmed ? 'opacity-55' : 'opacity-100'
      } ${selected ? '-translate-y-3 ring-2 ring-amber-300' : ''} ${
        onClick && playable ? 'cursor-pointer' : onClick ? 'cursor-not-allowed' : ''
      }`}
    >
      {/* Subtle geometric inner frame */}
      <div className="pointer-events-none absolute inset-1.5 rounded-lg border border-white/20" />

      {/* Top-left corner rank + colorblind suit symbol */}
      <div className="relative z-10 flex items-center justify-between w-full leading-none">
        <span className="font-bold tracking-tight text-xs sm:text-sm font-mono tabular-nums drop-shadow-xs">
          {rank}
        </span>
        <SuitGeometricSvg
          color={card.color}
          className="w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-95"
        />
      </div>

      {/* Center Ivory / Obsidian Emblem Medallion */}
      <div className="relative z-10 my-auto mx-auto flex flex-col items-center justify-center w-11 h-14 sm:w-14 sm:h-18 rounded-xl bg-stone-50/95 text-slate-900 shadow-inner border border-black/10">
        {isWild ? (
          <div className="flex flex-col items-center justify-center gap-0.5">
            <SuitGeometricSvg color="WILD" className="w-6 h-6 sm:w-7 sm:h-7" />
            <span className="text-xs sm:text-sm font-extrabold font-mono text-slate-900 leading-none">
              {card.kind === 'WILD_DRAW_FOUR' ? '+4' : 'WILD'}
            </span>
          </div>
        ) : (
          <div className={`flex flex-col items-center justify-center ${suit!.textClass}`}>
            <span className="text-xl sm:text-2xl font-extrabold tracking-tight leading-none font-mono tabular-nums">
              {rank}
            </span>
            <span className="text-[10px] sm:text-xs font-bold leading-none mt-0.5">
              {suit!.symbol}
            </span>
          </div>
        )}
      </div>

      {/* Bottom-right corner rank + suit symbol */}
      <div className="relative z-10 flex items-center justify-between w-full leading-none rotate-180">
        <span className="font-bold tracking-tight text-xs sm:text-sm font-mono tabular-nums drop-shadow-xs">
          {rank}
        </span>
        <SuitGeometricSvg
          color={card.color}
          className="w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-95"
        />
      </div>
    </Component>
  );
}

export function CardBackGraphic({
  size = 'md',
  count,
  highlighted = false,
  onClick,
  label = 'Draw Card',
}: {
  readonly size?: 'sm' | 'md' | 'lg';
  readonly count?: number;
  readonly highlighted?: boolean;
  readonly onClick?: () => void;
  readonly label?: string;
}) {
  const Component = onClick ? motion.button : motion.div;
  return (
    <Component
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      aria-label={label}
      whileHover={onClick ? { y: -4, scale: 1.02 } : undefined}
      whileTap={onClick ? { scale: 0.97 } : undefined}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className={`relative select-none flex flex-col items-center justify-center overflow-hidden bg-slate-900 text-stone-100 ${
        SIZE_CLASSES[size]
      } ${
        highlighted
          ? 'border-2 border-emerald-400 ring-2 ring-emerald-400/50 shadow-lg cursor-pointer'
          : 'border border-white/15 shadow-md'
      } ${onClick && !highlighted ? 'cursor-pointer hover:border-white/35' : ''}`}
    >
      <div className="pointer-events-none absolute inset-1.5 rounded-lg border border-white/10 bg-gradient-to-br from-slate-800/80 via-slate-900 to-emerald-950/80" />
      <div className="relative z-10 flex flex-col items-center gap-1">
        <SuitGeometricSvg color="WILD" className="w-6 h-6 sm:w-7 sm:h-7" />
        <span className="text-[10px] sm:text-xs font-bold tracking-tight text-stone-200">
          CLASH
        </span>
        {typeof count === 'number' && (
          <span className="text-[10px] font-mono tabular-nums text-stone-400">
            {count}
          </span>
        )}
      </div>
    </Component>
  );
}

'use client';

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Film } from 'lucide-react';
import {
  COLORED_SUITS,
  type Card,
  type ColoredCardColor,
  type OpponentView,
  type PlayerView,
} from '@cardclash/engine';
import { SUIT_META, SuitGeometricSvg } from './card-graphic';

export function WildColorPickerModal({
  open,
  title = 'Choose Active Suit Color',
  subtitle = 'Select the suit color and symbol to set as active',
  onSelectColor,
  onCancel,
}: {
  readonly open: boolean;
  readonly title?: string;
  readonly subtitle?: string;
  readonly onSelectColor: (color: ColoredCardColor) => void;
  readonly onCancel?: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/15 p-5 text-stone-100 shadow-2xl space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
              <p className="text-xs text-stone-400">{subtitle}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {COLORED_SUITS.map((color) => {
                const meta = SUIT_META[color];
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => onSelectColor(color)}
                    className={`flex items-center justify-between min-h-14 px-4 py-3 rounded-xl text-white font-semibold border transition-transform active:scale-95 cursor-pointer ${meta.bgClass} ${meta.borderClass}`}
                  >
                    <span className="text-sm whitespace-nowrap">{meta.label}</span>
                    <span className="flex items-center gap-1.5 text-base font-mono">
                      <SuitGeometricSvg color={color} className="w-5 h-5" />
                    </span>
                  </button>
                );
              })}
            </div>

            {onCancel && (
              <div className="pt-1 flex justify-end">
                <button
                  type="button"
                  onClick={onCancel}
                  className="px-4 py-2 text-xs font-medium text-stone-300 hover:text-white rounded-lg hover:bg-white/5 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SwapTargetModal({
  open,
  opponents,
  onSelectTarget,
}: {
  readonly open: boolean;
  readonly opponents: readonly OpponentView[];
  readonly onSelectTarget: (targetPlayerId: string) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/15 p-5 text-stone-100 shadow-2xl space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight">
                7-0 Swap Rule: Choose Swap Target
              </h2>
              <p className="text-xs text-stone-400">
                You played a 7 card. Select an opponent to swap entire hands with.
              </p>
            </div>

            <div className="space-y-2">
              {opponents.map((opp) => (
                <button
                  key={opp.id}
                  type="button"
                  onClick={() => onSelectTarget(opp.id)}
                  className="w-full flex items-center justify-between min-h-12 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-left transition-colors cursor-pointer"
                >
                  <span className="text-sm font-semibold">{opp.name}</span>
                  <span className="text-xs font-mono text-emerald-400">
                    {opp.cardCount} cards
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Wd4ChallengeModal({
  open,
  blufferName,
  onAcceptPenalty,
  onChallenge,
}: {
  readonly open: boolean;
  readonly blufferName: string;
  readonly onAcceptPenalty: () => void;
  readonly onChallenge: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-amber-500/30 p-5 text-stone-100 shadow-2xl space-y-4"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold tracking-tight text-amber-300">
                Wild Draw Four Challenge
              </h2>
              <p className="text-xs text-stone-300">
                {blufferName} played a Wild Draw Four against you. Do you want to challenge their play?
              </p>
            </div>

            <div className="rounded-xl bg-slate-950/80 border border-white/10 p-3 text-[11px] text-stone-400 space-y-1">
              <p>
                <strong className="text-white">If they bluffed</strong> (had the previous active color): They draw 4 cards.
              </p>
              <p>
                <strong className="text-white">If legal</strong>: You draw 6 cards (4 + 2 penalty).
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onAcceptPenalty}
                className="min-h-11 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-stone-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                Accept Draw 4
              </button>
              <button
                type="button"
                onClick={onChallenge}
                className="min-h-11 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white transition-colors whitespace-nowrap cursor-pointer"
              >
                Challenge Play
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function RoundSummaryModal({
  view,
  viewerName,
  viewerScore = 0,
  onStartNextRound,
  onRematch,
  onLeaveTable,
  onWatchReplay,
}: {
  readonly view: PlayerView;
  readonly viewerName: string;
  readonly viewerScore?: number;
  readonly onStartNextRound: () => void;
  readonly onRematch?: () => void;
  readonly onLeaveTable: () => void;
  readonly onWatchReplay?: () => void;
}) {
  const isRoundOver = view.status === 'ROUND_OVER';
  const isMatchOver = view.status === 'MATCH_OVER';
  const isOpen = isRoundOver || isMatchOver;

  const winnerName =
    view.roundWinnerId === view.viewerId
      ? viewerName
      : view.opponents.find((o) => o.id === view.roundWinnerId)?.name ??
        'A player';

  const allStandings = [
    {
      id: view.viewerId,
      name: `${viewerName} (You)`,
      cardsLeft: view.hand.length,
      score: viewerScore,
    },
    ...view.opponents.map((o) => ({
      id: o.id,
      name: o.name,
      cardsLeft: o.cardCount,
      score: o.score,
    })),
  ].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-white/15 p-6 text-stone-100 shadow-2xl space-y-5"
          >
            <div className="space-y-1">
              <p className="text-xs text-emerald-400 font-medium">
                {isMatchOver
                  ? `Match Complete · Target ${view.targetScore} pts`
                  : `Round ${view.roundNumber} Complete`}
              </p>
              <h2 className="text-xl font-bold tracking-tight">
                {winnerName} won {isMatchOver ? 'the Match!' : `Round ${view.roundNumber}`}
              </h2>
            </div>

            <div className="space-y-2 border-t border-b border-white/10 py-3">
              <div className="flex items-center justify-between text-xs text-stone-400 pb-1">
                <span>Player</span>
                <span>Remaining · Score</span>
              </div>
              {allStandings.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between text-sm py-1"
                >
                  <span className="font-medium text-stone-100 truncate">
                    {row.name}
                  </span>
                  <span className="font-mono tabular-nums text-xs text-stone-300">
                    {row.cardsLeft} cards
                    {typeof row.score === 'number' ? ` · ${row.score} pts` : ''}
                  </span>
                </div>
              ))}
            </div>

            {isMatchOver && view.revealedSeed && (
              <div className="space-y-1 bg-slate-950/80 border border-white/10 rounded-xl p-3">
                <p className="text-[11px] text-stone-400">
                  Verified Match Seed (Revealed Post-Match)
                </p>
                <p className="text-[11px] font-mono break-all text-emerald-300 select-all">
                  {view.revealedSeed}
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={onLeaveTable}
                className="min-h-11 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-stone-200 transition-colors whitespace-nowrap cursor-pointer"
              >
                Leave Table
              </button>

              {isMatchOver && onWatchReplay && (
                <button
                  type="button"
                  onClick={onWatchReplay}
                  className="min-h-11 px-4 py-2 rounded-xl bg-indigo-600/80 hover:bg-indigo-600 text-xs font-semibold text-white flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Watch Replay</span>
                </button>
              )}

              {isMatchOver && onRematch && (
                <button
                  type="button"
                  onClick={onRematch}
                  className="min-h-11 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors whitespace-nowrap cursor-pointer"
                >
                  Rematch
                </button>
              )}

              {!isMatchOver && (
                <button
                  type="button"
                  onClick={onStartNextRound}
                  className="min-h-11 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white transition-colors whitespace-nowrap cursor-pointer"
                >
                  Start Round {view.roundNumber + 1}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type PendingWildSelection =
  | { readonly mode: 'INITIAL_FLIP' }
  | { readonly mode: 'PLAY_WILD'; readonly card: Card };

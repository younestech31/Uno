'use client';

import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  LogOut,
  Users,
  Hand,
  AlertTriangle,
  ArrowRight,
  MessageSquare,
  Eye,
  Film,
} from 'lucide-react';
import {
  isExactJumpInMatch,
  isPlayable,
  type Card,
  type ColoredCardColor,
  type PlayerView,
} from '@cardclash/engine';
import type { ClientGameActionDraft, PublicRoomState } from '@cardclash/protocol';
import {
  CardBackGraphic,
  CardGraphic,
  SUIT_META,
  SuitGeometricSvg,
} from './card-graphic';
import {
  RoundSummaryModal,
  SwapTargetModal,
  Wd4ChallengeModal,
  WildColorPickerModal,
  type PendingWildSelection,
} from './table-modals';

export interface CompanionSeatInfo {
  readonly playerId: string;
  readonly name: string;
  readonly hasTurn: boolean;
  readonly cardCount: number;
}

export interface CardTableViewProps {
  readonly room: PublicRoomState;
  readonly view: PlayerView;
  readonly viewerName: string;
  readonly turnDeadlineAt: number | null;
  readonly companionSeats: readonly CompanionSeatInfo[];
  readonly activeSeatId: string;
  readonly autoPlayCompanions: boolean;
  readonly soundEnabled: boolean;
  readonly lastActionText?: string | null;
  readonly isSpectator?: boolean;
  readonly spectatorCount?: number;
  readonly unreadChatCount?: number;
  readonly onOpenChat?: () => void;
  readonly onWatchReplay?: () => void;
  readonly onSwitchSeat: (playerId: string) => void;
  readonly onToggleAutoPlay: () => void;
  readonly onToggleSound: () => void;
  readonly onDispatchAction: (intent: ClientGameActionDraft) => void;
  readonly onRematch: () => void;
  readonly onLeaveRoom: () => void;
}

export function CardTableView({
  room,
  view,
  viewerName,
  turnDeadlineAt,
  companionSeats,
  activeSeatId,
  autoPlayCompanions,
  soundEnabled,
  lastActionText,
  isSpectator = false,
  spectatorCount = 0,
  unreadChatCount = 0,
  onOpenChat,
  onWatchReplay,
  onSwitchSeat,
  onToggleAutoPlay,
  onToggleSound,
  onDispatchAction,
  onRematch,
  onLeaveRoom,
}: CardTableViewProps) {
  const [pendingWildCard, setPendingWildCard] = useState<Card | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  React.useEffect(() => {
    const deadline = turnDeadlineAt ?? room.turnDeadlineAt ?? null;
    if (!deadline || view.status !== 'IN_PROGRESS') {
      return;
    }

    const interval = setInterval(() => {
      setNowTick(Date.now());
    }, 250);
    return () => clearInterval(interval);
  }, [turnDeadlineAt, room.turnDeadlineAt, view.status]);

  const activeDeadline = turnDeadlineAt ?? room.turnDeadlineAt ?? null;
  const secondsRemaining =
    activeDeadline && view.status === 'IN_PROGRESS'
      ? Math.max(0, Math.ceil((activeDeadline - nowTick) / 1000))
      : null;

  const isMyTurn = !isSpectator && view.currentPlayerId === view.viewerId;
  const activePlayerName = isMyTurn
    ? `${viewerName} (Your Turn)`
    : view.opponents.find((o) => o.id === view.currentPlayerId)?.name ??
      (view.currentPlayerId === view.viewerId ? viewerName : 'Opponent');

  // Determine which cards in hand are playable
  const canJumpInNow =
    !isSpectator &&
    !isMyTurn &&
    view.houseRules.jumpIn &&
    view.turnPhase === 'PLAY_OR_DRAW' &&
    view.pendingDrawCount === 0;

  const checkCardPlayable = (card: Card): boolean => {
    if (isSpectator) return false;
    if (view.status !== 'IN_PROGRESS') return false;
    if (isMyTurn) {
      return isPlayable(card, {
        topCard: view.topDiscard,
        currentColor: view.currentColor,
        hand: view.hand,
        houseRules: view.houseRules,
        turnPhase: view.turnPhase,
        pendingDrawCount: view.pendingDrawCount,
        pendingDrawnCardId: view.pendingDrawnCardId,
      });
    }
    if (canJumpInNow) {
      return isExactJumpInMatch(card, view.topDiscard);
    }
    return false;
  };

  const playableCardIds = new Set(
    view.hand.filter(checkCardPlayable).map((c) => c.id)
  );

  const canDrawNow =
    !isSpectator &&
    isMyTurn &&
    view.status === 'IN_PROGRESS' &&
    (view.turnPhase === 'PLAY_OR_DRAW' || view.turnPhase === 'STACK_OR_DRAW');

  const canPassNow =
    !isSpectator &&
    isMyTurn &&
    view.status === 'IN_PROGRESS' &&
    view.turnPhase === 'DRAWN_PLAY_OR_PASS';

  const canCallUnoNow =
    !isSpectator &&
    view.status === 'IN_PROGRESS' &&
    (view.hand.length === 2 || view.hand.length === 1);

  // Catch Uno opponents vulnerable
  const vulnerableOpponents = isSpectator
    ? []
    : view.opponents.filter((o) => o.id === view.unoVulnerablePlayerId);

  const handleCardClick = (card: Card) => {
    if (isSpectator) return;
    if (!playableCardIds.has(card.id)) return;

    if (card.color === 'WILD') {
      setPendingWildCard(card);
      return;
    }

    onDispatchAction({
      type: 'PLAY_CARD',
      cardId: card.id,
      callUno: view.hand.length === 2,
    });
  };

  const handleWildColorSelected = (color: ColoredCardColor) => {
    if (view.turnPhase === 'AWAITING_INITIAL_WILD_COLOR' && isMyTurn) {
      onDispatchAction({
        type: 'CHOOSE_INITIAL_COLOR',
        color,
      });
      return;
    }
    if (pendingWildCard) {
      const cardId = pendingWildCard.id;
      setPendingWildCard(null);
      onDispatchAction({
        type: 'PLAY_CARD',
        cardId,
        chosenColor: color,
        callUno: view.hand.length === 2,
      });
    }
  };

  const activeSuitMeta = view.currentColor ? SUIT_META[view.currentColor] : null;

  // Format active house rules as unboxed text with · separators
  const enabledRulesList: string[] = [];
  if (view.houseRules.stacking) enabledRulesList.push('Stacking');
  if (view.houseRules.sevenZeroSwap) enabledRulesList.push('7-0 Swap');
  if (view.houseRules.jumpIn) enabledRulesList.push('Jump-In');
  if (view.houseRules.wildDrawFourChallenge) enabledRulesList.push('+4 Challenge');

  return (
    <div className="min-h-screen w-full bg-[#0B2B26] text-stone-100 flex flex-col justify-between select-none overflow-x-hidden relative">
      {/* Ambient Full-Screen Viewport Flash Overlay */}
      <motion.div
        key={`flash-${view.topDiscard.id}`}
        initial={{ opacity: 0.16 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className={`pointer-events-none fixed inset-0 z-10 ${
          view.topDiscard.color === 'RED'
            ? 'bg-rose-500'
            : view.topDiscard.color === 'BLUE'
              ? 'bg-blue-500'
              : view.topDiscard.color === 'YELLOW'
                ? 'bg-amber-400'
                : view.topDiscard.color === 'GREEN'
                  ? 'bg-emerald-500'
                  : view.topDiscard.kind === 'WILD_DRAW_FOUR'
                    ? 'bg-gradient-to-r from-amber-400 via-yellow-300 to-orange-500'
                    : 'bg-indigo-500'
        }`}
      />

      {/* Top Table HUD Bar */}
      <header className="w-full border-b border-white/10 bg-[#09221E]/90 px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-base sm:text-lg font-bold tracking-tight text-stone-100 whitespace-nowrap">
            CardClash
          </span>
          <div className="hidden sm:flex items-center gap-2 text-xs text-stone-300 font-mono tabular-nums">
            <span>Room {room.roomCode}</span>
            <span aria-hidden="true">·</span>
            <span>Round {view.roundNumber}</span>
            <span aria-hidden="true">·</span>
            <span>Target {view.targetScore} pts</span>
            {enabledRulesList.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-300">
                  {enabledRulesList.join(' / ')}
                </span>
              </>
            )}
          </div>
          {isSpectator && (
            <span className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-semibold">
              <Eye className="w-3 h-3" />
              Spectating Live
            </span>
          )}
        </div>

        {/* Multi-Seat Switcher */}
        {companionSeats.length > 1 && (
          <div className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-lg border border-white/10 overflow-x-auto max-w-[52vw] sm:max-w-none">
            {companionSeats.map((seat) => {
              const isSelected = seat.playerId === activeSeatId;
              return (
                <button
                  key={seat.playerId}
                  type="button"
                  onClick={() => onSwitchSeat(seat.playerId)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-600 text-white'
                      : seat.hasTurn
                        ? 'text-amber-300 hover:bg-white/5'
                        : 'text-stone-400 hover:text-stone-200'
                  }`}
                >
                  {seat.name} ({seat.cardCount})
                  {seat.hasTurn ? ' •' : ''}
                </button>
              );
            })}
            <button
              type="button"
              onClick={onToggleAutoPlay}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                autoPlayCompanions
                  ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                  : 'bg-white/5 text-stone-400 hover:text-white'
              }`}
            >
              Bots {autoPlayCompanions ? 'ON' : 'OFF'}
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          {onOpenChat && (
            <button
              type="button"
              onClick={onOpenChat}
              className="relative p-2 rounded-lg bg-white/5 hover:bg-white/10 text-stone-300 hover:text-white transition-colors cursor-pointer"
              title="Open In-Game Chat"
            >
              <MessageSquare className="w-4 h-4 text-indigo-300" />
              {unreadChatCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-xs">
                  {unreadChatCount}
                </span>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={onToggleSound}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-stone-300 hover:text-white transition-colors cursor-pointer"
            title={soundEnabled ? 'Mute SFX' : 'Enable SFX'}
          >
            {soundEnabled ? (
              <Volume2 className="w-4 h-4" />
            ) : (
              <VolumeX className="w-4 h-4 text-stone-500" />
            )}
          </button>

          <button
            type="button"
            onClick={onLeaveRoom}
            className="p-2 rounded-lg bg-white/5 hover:bg-rose-500/20 text-stone-300 hover:text-rose-300 transition-colors cursor-pointer"
            title="Leave Table"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Opponents Ribbon */}
      <section className="w-full px-3 py-2 sm:py-3 flex items-center justify-center gap-3 sm:gap-6 flex-wrap">
        {view.opponents.map((opp) => {
          const isOppTurn = opp.id === view.currentPlayerId;
          return (
            <div
              key={opp.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                isOppTurn
                  ? 'bg-amber-500/20 border-amber-400/60 shadow-lg scale-105'
                  : 'bg-slate-900/60 border-white/10'
              }`}
            >
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-stone-100 truncate max-w-[100px] sm:max-w-[140px]">
                    {opp.name}
                  </span>
                  {!opp.connected && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 font-mono">
                      OFFLINE
                    </span>
                  )}
                  {opp.calledUno && (
                    <span className="text-[10px] font-black px-1.5 py-0.2 rounded bg-amber-500 text-slate-950">
                      UNO!
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-stone-400 font-mono tabular-nums mt-0.5">
                  <span>{opp.cardCount} cards</span>
                  <span aria-hidden="true">·</span>
                  <span>{opp.score} pts</span>
                </div>
              </div>

              {/* Fanned Mini Card Backs (max 3 overlapping cards with tight overlay to prevent clipping on mobile) */}
              <div className="flex -space-x-5 pl-1.5 shrink-0">
                {Array.from({ length: Math.min(opp.cardCount, 3) }).map((_, i) => (
                  <div key={i} className="transform scale-55 -my-2 origin-left">
                    <CardBackGraphic />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* Main Table Arena */}
      <main className="flex-1 flex flex-col items-center justify-center p-3 relative">
        {/* Turn Direction, Turn Timer & Action Ticker Banner */}
        <div className="mb-4 flex flex-col items-center gap-1.5 text-xs font-semibold text-stone-300 bg-slate-950/70 px-4.5 py-2 rounded-2xl border border-white/10 backdrop-blur-sm shadow-xl max-w-lg w-full sm:w-auto">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-emerald-400">
              {view.direction === 1 ? (
                <>
                  <RotateCw className="w-3.5 h-3.5" /> Clockwise
                </>
              ) : (
                <>
                  <RotateCcw className="w-3.5 h-3.5" /> Counter-Clockwise
                </>
              )}
            </span>

            <span aria-hidden="true" className="text-white/20">
              |
            </span>

            <span className={isMyTurn ? 'text-amber-300 font-bold animate-pulse' : 'text-stone-300'}>
              {activePlayerName}
            </span>

            {secondsRemaining !== null && (
              <>
                <span aria-hidden="true" className="text-white/20">
                  |
                </span>
                <span
                  className={`font-mono tabular-nums font-bold ${
                    secondsRemaining <= 10 ? 'text-rose-400 animate-ping' : 'text-stone-300'
                  }`}
                >
                  {secondsRemaining}s
                </span>
              </>
            )}
          </div>

          {lastActionText && (
            <div className="pt-1.5 border-t border-white/10 w-full text-center text-xs font-semibold text-emerald-300 tracking-tight transition-all">
              {lastActionText}
            </div>
          )}
        </div>

        {/* Center Piles Layout */}
        <div className="flex items-center gap-6 sm:gap-10">
          {/* Draw Deck */}
          <div className="flex flex-col items-center gap-2">
            <motion.button
              type="button"
              disabled={!canDrawNow}
              onClick={() => {
                if (canDrawNow) {
                  onDispatchAction({ type: 'DRAW_CARD' });
                }
              }}
              animate={canDrawNow ? {
                scale: [1, 1.04, 1],
                boxShadow: [
                  "0px 0px 0px 0px rgba(16, 185, 129, 0)",
                  "0px 0px 14px 4px rgba(16, 185, 129, 0.4)",
                  "0px 0px 0px 0px rgba(16, 185, 129, 0)"
                ]
              } : {}}
              transition={canDrawNow ? {
                duration: 1.8,
                repeat: Infinity,
                ease: "easeInOut"
              } : {}}
              className={`relative transform transition-all active:scale-95 ${
                canDrawNow
                  ? 'cursor-pointer ring-2 ring-emerald-400 shadow-xl'
                  : 'opacity-80 cursor-not-allowed'
              }`}
            >
              <CardBackGraphic />
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="px-2 py-0.5 rounded-full bg-slate-950/80 text-white font-mono text-xs font-bold border border-white/10">
                  {view.drawPileCount}
                </span>
              </div>
            </motion.button>
            <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
              {canDrawNow ? 'Tap to Draw' : 'Draw Deck'}
            </span>
          </div>

          {/* Active Discard Pile */}
          <div className="flex flex-col items-center gap-2">
            <motion.div
              key={view.topDiscard.id}
              initial={{ scale: 0.65, rotate: -20, y: -15, opacity: 0.5 }}
              animate={{ scale: 1, rotate: 0, y: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 240, damping: 14 }}
              className="relative transform hover:rotate-1 transition-transform"
            >
              <CardGraphic card={view.topDiscard} />

              {/* Active Suit Color Ring / Floating Badge */}
              {activeSuitMeta && (
                <div
                  className={`absolute -top-3 -right-3 px-2.5 py-1 rounded-full text-white font-bold text-xs flex items-center gap-1 shadow-lg border ${activeSuitMeta.bgClass} ${activeSuitMeta.borderClass}`}
                >
                  <SuitGeometricSvg color={view.currentColor!} className="w-3.5 h-3.5" />
                  <span>{activeSuitMeta.label}</span>
                </div>
              )}
            </motion.div>
            <span className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">
              Discard Pile
            </span>
          </div>
        </div>

        {/* Action Callouts / Penalties */}
        {view.pendingDrawCount > 0 && (
          <div className="mt-4 px-4 py-1.5 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center gap-2 animate-bounce">
            <AlertTriangle className="w-4 h-4" />
            <span>+{view.pendingDrawCount} Draw Penalty Active! Play matching +2/+4 or draw.</span>
          </div>
        )}

        {/* Pass Button when in DRAWN_PLAY_OR_PASS phase */}
        {canPassNow && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => onDispatchAction({ type: 'PASS_TURN' })}
              className="min-h-11 px-6 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg transition-transform active:scale-95 cursor-pointer"
            >
              <span>Pass Turn</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </main>

      {/* Bottom Player Hand & Action Controls Bar */}
      <footer className="w-full border-t border-white/10 bg-[#09221E]/95 px-3 sm:px-6 py-3 space-y-3">
        {/* Tactical Buttons Toolbar: UNO / Catch UNO / Spectator Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 max-w-5xl mx-auto">
          <div className="flex items-center gap-2">
            {isSpectator ? (
              <span className="text-xs text-cyan-300 font-medium">
                Spectator View • Watch live moves unfold deterministically
              </span>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!canCallUnoNow}
                  onClick={() => onDispatchAction({ type: 'CALL_UNO' })}
                  className={`min-h-10 px-4 py-1.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer ${
                    canCallUnoNow
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 ring-2 ring-amber-300 shadow-lg shadow-amber-500/30 active:scale-95'
                      : 'bg-white/5 text-stone-500 opacity-40 cursor-not-allowed'
                  }`}
                >
                  Call UNO!
                </button>

                {vulnerableOpponents.map((opp) => (
                  <button
                    key={opp.id}
                    type="button"
                    onClick={() =>
                      onDispatchAction({
                        type: 'CATCH_UNO',
                        targetPlayerId: opp.id,
                      })
                    }
                    className="min-h-10 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-1 shadow-md transition-transform active:scale-95 cursor-pointer"
                  >
                    <Hand className="w-3.5 h-3.5" />
                    <span>Catch {opp.name}!</span>
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="text-xs text-stone-400 font-mono tabular-nums">
            {isSpectator
              ? `${spectatorCount} Spectators in room`
              : `Your Hand: ${view.hand.length} cards`}
          </div>
        </div>

        {/* Fanned Player Hand Container */}
        <div className="w-full overflow-x-auto pb-1 flex items-center justify-center">
          <div className="flex -space-x-6 sm:-space-x-8 px-4 py-2 min-w-max">
            {view.hand.map((card, index) => {
              const playable = playableCardIds.has(card.id);
              const rotationDeg = (index - (view.hand.length - 1) / 2) * 3;
              return (
                <motion.div
                  key={card.id}
                  whileHover={playable ? { y: -24, scale: 1.08, zIndex: 30 } : undefined}
                  style={{ transform: `rotate(${rotationDeg}deg)` }}
                  className={`transition-all duration-150 ${
                    playable
                      ? 'cursor-pointer'
                      : 'opacity-50 grayscale-40 cursor-not-allowed'
                  }`}
                  onClick={() => handleCardClick(card)}
                >
                  <CardGraphic card={card} playable={playable} />
                </motion.div>
              );
            })}
          </div>
        </div>
      </footer>

      {/* Modals & Dialogs */}
      <WildColorPickerModal
        open={Boolean(pendingWildCard) || view.turnPhase === 'AWAITING_INITIAL_WILD_COLOR'}
        title={
          view.turnPhase === 'AWAITING_INITIAL_WILD_COLOR'
            ? 'First Card is Wild: Select Initial Color'
            : 'Wild Card Played: Choose Color'
        }
        onSelectColor={handleWildColorSelected}
        onCancel={() => setPendingWildCard(null)}
      />

      <SwapTargetModal
        open={view.turnPhase === 'AWAITING_SWAP_TARGET'}
        opponents={view.opponents}
        onSelectTarget={(targetPlayerId) =>
          onDispatchAction({
            type: 'CHOOSE_SWAP_TARGET',
            targetPlayerId,
          })
        }
      />

      <Wd4ChallengeModal
        open={view.turnPhase === 'AWAITING_WD4_CHALLENGE'}
        blufferName={
          view.opponents.find((o) => o.id === view.currentPlayerId)?.name ??
          'Opponent'
        }
        onAcceptPenalty={() =>
          onDispatchAction({ type: 'ACCEPT_WILD_DRAW_FOUR' })
        }
        onChallenge={() =>
          onDispatchAction({ type: 'CHALLENGE_WILD_DRAW_FOUR' })
        }
      />

      <RoundSummaryModal
        view={view}
        viewerName={viewerName}
        onStartNextRound={() =>
          onDispatchAction({ type: 'START_NEXT_ROUND' })
        }
        onRematch={onRematch}
        onLeaveTable={onLeaveRoom}
        onWatchReplay={onWatchReplay}
      />
    </div>
  );
}

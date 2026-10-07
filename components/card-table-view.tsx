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
  ChevronLeft,
  ChevronRight,
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
  const handScrollRef = React.useRef<HTMLDivElement>(null);

  // Pure smooth drag/slide state for buttonless hand navigation
  const [isPointerDown, setIsPointerDown] = useState(false);
  const [startX, setStartX] = useState(0);
  const [initialScrollLeft, setInitialScrollLeft] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!handScrollRef.current) return;
    setIsPointerDown(true);
    setIsDragging(false);
    setStartX(e.clientX - handScrollRef.current.offsetLeft);
    setInitialScrollLeft(handScrollRef.current.scrollLeft);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDown || !handScrollRef.current) return;
    const x = e.clientX - handScrollRef.current.offsetLeft;
    const walk = (x - startX) * 1.5;
    if (Math.abs(walk) > 5) {
      setIsDragging(true);
    }
    handScrollRef.current.scrollLeft = initialScrollLeft - walk;
  };

  const handlePointerUpOrLeave = () => {
    setIsPointerDown(false);
    setTimeout(() => setIsDragging(false), 50);
  };

  const handleHandWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (handScrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      handScrollRef.current.scrollLeft += e.deltaY;
    }
  };

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

  const isNoMercy = view.houseRules.gameMode === 'NO_MERCY';

  const checkCardPlayable = (card: Card): boolean => {
    if (isSpectator || view.eliminated) return false;
    if (view.status !== 'IN_PROGRESS') return false;
    if (isMyTurn) {
      return isPlayable(card, {
        topCard: view.topDiscard,
        currentColor: view.currentColor,
        hand: view.hand,
        houseRules: view.houseRules,
        turnPhase: view.turnPhase,
        pendingDrawCount: view.pendingDrawCount,
        pendingDrawKind: view.pendingDrawKind,
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
    !view.eliminated &&
    isMyTurn &&
    view.status === 'IN_PROGRESS' &&
    (view.turnPhase === 'PLAY_OR_DRAW' || view.turnPhase === 'STACK_OR_DRAW');

  const canPassNow =
    !isSpectator &&
    !view.eliminated &&
    isMyTurn &&
    view.status === 'IN_PROGRESS' &&
    view.turnPhase === 'DRAWN_PLAY_OR_PASS';

  const canCallUnoNow =
    !isSpectator &&
    !view.eliminated &&
    view.status === 'IN_PROGRESS' &&
    (view.hand.length === 2 || view.hand.length === 1);

  // Catch Uno opponents vulnerable
  const vulnerableOpponents = isSpectator
    ? []
    : view.opponents.filter((o) => o.id === view.unoVulnerablePlayerId && !o.eliminated);

  const willLeaveOneCardAfterPlay = (card: Card): boolean => {
    if (card.kind === 'DISCARD_ALL') {
      const remaining = view.hand.filter(
        (c) => c.id !== card.id && c.color !== card.color
      );
      return remaining.length === 1;
    }
    return view.hand.length === 2;
  };

  const handleCardClick = (card: Card) => {
    if (isDragging) return;
    if (isSpectator || view.eliminated) return;
    if (!playableCardIds.has(card.id)) return;

    // WILD_COLOR_ROULETTE does not ask the attacker for a color; the next player chooses!
    if (card.color === 'WILD' && card.kind !== 'WILD_COLOR_ROULETTE') {
      setPendingWildCard(card);
      return;
    }

    onDispatchAction({
      type: 'PLAY_CARD',
      cardId: card.id,
      callUno: willLeaveOneCardAfterPlay(card),
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
    if (view.turnPhase === 'AWAITING_ROULETTE_COLOR' && isMyTurn) {
      onDispatchAction({
        type: 'CHOOSE_ROULETTE_COLOR',
        color,
      });
      return;
    }
    if (pendingWildCard) {
      const card = pendingWildCard;
      setPendingWildCard(null);
      onDispatchAction({
        type: 'PLAY_CARD',
        cardId: card.id,
        chosenColor: color,
        callUno: willLeaveOneCardAfterPlay(card),
      });
    }
  };

  const activeSuitMeta = view.currentColor ? SUIT_META[view.currentColor] : null;

  // Format active house rules as unboxed text with · separators
  const enabledRulesList: string[] = [];
  if (isNoMercy) enabledRulesList.push('NO MERCY (25-Card KO)');
  if (view.houseRules.stacking) enabledRulesList.push(isNoMercy ? 'Progressive Stack' : 'Stacking');
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
                  : view.topDiscard.kind === 'WILD_DRAW_TEN' ||
                      view.topDiscard.kind === 'WILD_DRAW_SIX'
                    ? 'bg-gradient-to-r from-rose-600 via-amber-500 to-red-700'
                    : view.topDiscard.kind === 'WILD_DRAW_FOUR' ||
                        view.topDiscard.kind === 'WILD_REVERSE_DRAW_FOUR'
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
          {isNoMercy && (
            <span className="px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-400/40 text-rose-300 font-mono text-[10px] font-extrabold uppercase tracking-wider">
              NO MERCY
            </span>
          )}
          <div className="hidden sm:flex items-center gap-2 text-xs text-stone-300 font-mono tabular-nums">
            <span>Room {room.roomCode}</span>
            <span aria-hidden="true">·</span>
            <span>Round {view.roundNumber}</span>
            <span aria-hidden="true">·</span>
            <span>Target {view.targetScore} pts</span>
            {enabledRulesList.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className={isNoMercy ? 'text-rose-300 font-semibold' : 'text-emerald-300'}>
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

      {/* Opponents Arena: 1v1 Mirrored Full Fanned Deck vs 3+ Player Adaptive Tabletop Fans */}
      {view.opponents.length === 1 ? (
        (() => {
          const opp = view.opponents[0]!;
          const isOppTurn = opp.id === view.currentPlayerId && !opp.eliminated;
          const visibleCount = Math.min(opp.cardCount, 14);
          const extraCount = Math.max(0, opp.cardCount - visibleCount);
          const angleStep = visibleCount > 10 ? 1.8 : visibleCount > 7 ? 2.4 : 3;
          const overlapClass =
            visibleCount > 10
              ? '-space-x-11 sm:-space-x-10'
              : visibleCount > 7
                ? '-space-x-9 sm:-space-x-8'
                : '-space-x-7 sm:-space-x-6';

          return (
            <section className="w-full border-b border-white/10 bg-[#09221E]/75 px-3 sm:px-6 pt-2.5 pb-3 flex flex-col items-center gap-2">
              {/* 1v1 Opponent Status Header (mirrors player footer toolbar) */}
              <div className="flex items-center justify-between gap-3 w-full max-w-4xl">
                <div className="flex items-center gap-2">
                  <div
                    className={`px-3 py-1 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all ${
                      opp.eliminated
                        ? 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                        : isOppTurn
                          ? 'bg-amber-500/20 border-amber-400 text-amber-200 shadow-md shadow-amber-500/10'
                          : 'bg-slate-900/70 border-white/10 text-stone-200'
                    }`}
                  >
                    <span className="truncate max-w-[140px] sm:max-w-[200px]">
                      {opp.name}
                    </span>
                    {opp.eliminated && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-600 text-white font-black">
                        KNOCKED OUT (25+)
                      </span>
                    )}
                    {isOppTurn && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400 text-slate-950 font-black">
                        Thinking
                      </span>
                    )}
                    {!opp.connected && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
                        OFFLINE
                      </span>
                    )}
                    {opp.calledUno && !opp.eliminated && (
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 animate-bounce">
                        UNO!
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs text-stone-300 font-mono tabular-nums">
                  <span
                    className={
                      isNoMercy && opp.cardCount >= 20
                        ? 'text-rose-400 font-bold'
                        : ''
                    }
                  >
                    Opponent Hand: {opp.cardCount}
                    {isNoMercy ? '/25 cards' : ' cards'}
                    {isNoMercy && opp.cardCount >= 20 && !opp.eliminated
                      ? ' · DANGER'
                      : ''}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-emerald-300 font-semibold">{opp.score} pts</span>
                </div>
              </div>

              {/* 1v1 Mirrored Fanned Card-Back Deck */}
              <div className="w-full overflow-x-auto pt-1 pb-2 flex items-center justify-center">
                <div className={`flex ${overlapClass} px-6 py-1.5 items-center justify-center min-w-max`}>
                  {Array.from({ length: visibleCount }).map((_, index) => {
                    const offsetFromCenter = index - (visibleCount - 1) / 2;
                    const rotationDeg = offsetFromCenter * -angleStep;
                    const archY = Math.abs(offsetFromCenter) * -1.5;
                    return (
                      <motion.div
                        key={`opp-1v1-card-${index}`}
                        initial={{ opacity: 0, y: -16, scale: 0.8 }}
                        animate={{ opacity: 1, y: archY, scale: 0.88 }}
                        transition={{ duration: 0.18 }}
                        style={{ transform: `translateY(${archY}px) rotate(${rotationDeg}deg)` }}
                        className="origin-top transition-transform duration-150 drop-shadow-md"
                      >
                        <CardBackGraphic />
                      </motion.div>
                    );
                  })}
                  {extraCount > 0 && (
                    <div className="ml-3 px-2.5 py-1 rounded-full bg-slate-950/90 border border-amber-400/40 text-amber-300 font-mono text-xs font-bold shadow-lg">
                      +{extraCount}
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })()
      ) : (
        <section className="w-full px-3 pt-2.5 pb-1 flex items-start justify-center gap-3 sm:gap-6 flex-wrap">
          {view.opponents.map((opp) => {
            const isOppTurn = opp.id === view.currentPlayerId && !opp.eliminated;
            const visibleCount = Math.min(opp.cardCount, 8);
            const extraCount = Math.max(0, opp.cardCount - visibleCount);
            const angleStep = visibleCount > 5 ? 3.2 : 4.2;
            const overlapClass =
              visibleCount > 5 ? '-space-x-12' : '-space-x-10';

            return (
              <div
                key={opp.id}
                className={`flex flex-col items-center px-3.5 pt-2 pb-2.5 rounded-2xl border transition-all min-w-[148px] sm:min-w-[172px] ${
                  opp.eliminated
                    ? 'bg-rose-950/40 border-rose-500/30 opacity-60'
                    : isOppTurn
                      ? 'bg-amber-500/15 border-amber-400/70 shadow-lg shadow-amber-500/10 scale-[1.03]'
                      : 'bg-slate-950/65 border-white/10'
                }`}
              >
                {/* Opponent Info Header */}
                <div className="flex items-center justify-between gap-2 w-full mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-bold text-stone-100 truncate max-w-[96px] sm:max-w-[120px]">
                      {opp.name}
                    </span>
                    {opp.eliminated && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-rose-600 text-white">
                        KO
                      </span>
                    )}
                    {!opp.connected && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
                        OFF
                      </span>
                    )}
                    {opp.calledUno && !opp.eliminated && (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 animate-bounce">
                        UNO!
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-emerald-300 font-semibold shrink-0">
                    {opp.score}p
                  </span>
                </div>

                {/* Compact Curved Fanned Card-Back Deck */}
                <div className="relative flex items-center justify-center h-14 sm:h-16 w-full overflow-visible my-0.5">
                  {opp.eliminated ? (
                    <span className="text-[10px] font-mono font-bold text-rose-300 uppercase tracking-wider">
                      Knocked Out (25+)
                    </span>
                  ) : (
                    <>
                      <div className={`flex ${overlapClass} items-center justify-center`}>
                        {Array.from({ length: visibleCount }).map((_, idx) => {
                          const offset = idx - (visibleCount - 1) / 2;
                          const deg = offset * -angleStep;
                          const archY = Math.abs(offset) * -1.2;
                          return (
                            <div
                              key={`opp-${opp.id}-card-${idx}`}
                              style={{
                                transform: `translateY(${archY}px) rotate(${deg}deg) scale(0.54)`,
                              }}
                              className="origin-center -my-6 transition-transform duration-150 drop-shadow-sm"
                            >
                              <CardBackGraphic />
                            </div>
                          );
                        })}
                      </div>
                      {extraCount > 0 && (
                        <span className="absolute -right-1 bottom-0 px-1.5 py-0.5 rounded-full bg-slate-950/90 border border-amber-400/40 text-amber-300 font-mono text-[10px] font-bold">
                          +{extraCount}
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div
                  className={`text-[10px] font-mono tabular-nums mt-0.5 ${
                    isNoMercy && opp.cardCount >= 20 && !opp.eliminated
                      ? 'text-rose-400 font-bold'
                      : 'text-stone-300'
                  }`}
                >
                  {opp.eliminated
                    ? 'Eliminated'
                    : isNoMercy
                      ? `${opp.cardCount}/25 cards${opp.cardCount >= 20 ? ' · DANGER' : ''}`
                      : `${opp.cardCount} ${opp.cardCount === 1 ? 'card' : 'cards'}`}
                </div>
              </div>
            );
          })}
        </section>
      )}

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
              {canDrawNow
                ? view.pendingDrawCount > 0
                  ? `Draw +${view.pendingDrawCount}`
                  : isNoMercy
                    ? 'Draw Until Playable'
                    : 'Tap to Draw'
                : 'Draw Deck'}
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
            <span>
              +{view.pendingDrawCount} Draw Stack Active!{' '}
              {isNoMercy
                ? 'Play equal or higher Draw card (+2/+4/+6/+10) or draw stack.'
                : 'Play matching +2/+4 or draw.'}
            </span>
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
            ) : view.eliminated ? (
              <span className="px-3 py-1 rounded-lg bg-rose-600/20 border border-rose-500/40 text-xs text-rose-300 font-bold">
                KNOCKED OUT (25+ Cards Mercy Rule) • Watching remaining players finish round
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

          <div
            className={`text-xs font-mono tabular-nums ${
              isNoMercy && view.hand.length >= 20
                ? 'text-rose-400 font-bold'
                : 'text-stone-400'
            }`}
          >
            {isSpectator
              ? `${spectatorCount} Spectators in room`
              : view.eliminated
                ? 'Eliminated (25+ Cards)'
                : isNoMercy
                  ? `Your Hand: ${view.hand.length}/25 cards${
                      view.hand.length >= 20 ? ' · MERCY DANGER!' : ''
                    }`
                  : `Your Hand: ${view.hand.length} cards`}
          </div>
        </div>

        {/* Buttonless, Scrollbar-Free Pure Sliding Player Hand Container */}
        <div className="w-full relative touch-pan-x">
          <div
            ref={handScrollRef}
            onWheel={handleHandWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUpOrLeave}
            onPointerLeave={handlePointerUpOrLeave}
            className="w-full overflow-x-auto overscroll-x-contain pb-3 pt-1 flex items-center justify-start sm:justify-center cursor-grab active:cursor-grabbing select-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* Generous Leading Spacer so first card is never clipped */}
            <div className="w-10 sm:w-20 shrink-0" aria-hidden="true" />

            <div
              className={`flex ${
                view.hand.length > 16
                  ? '-space-x-12 sm:-space-x-11'
                  : view.hand.length > 12
                    ? '-space-x-10 sm:-space-x-10'
                    : view.hand.length > 8
                      ? '-space-x-8 sm:-space-x-9'
                      : '-space-x-6 sm:-space-x-7'
              } px-2 py-2 min-w-max items-center`}
            >
              {view.hand.map((card, index) => {
                const playable = playableCardIds.has(card.id);
                const angleStep =
                  view.hand.length > 16 ? 0.9 : view.hand.length > 12 ? 1.4 : view.hand.length > 8 ? 2.0 : 2.8;
                const rotationDeg = (index - (view.hand.length - 1) / 2) * angleStep;
                return (
                  <motion.div
                    key={card.id}
                    whileHover={playable ? { y: -26, scale: 1.1, zIndex: 40 } : undefined}
                    style={{ transform: `rotate(${rotationDeg}deg)` }}
                    className={`transition-all duration-150 shrink-0 ${
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

            {/* Generous Trailing Spacer so last card is never clipped */}
            <div className="w-14 sm:w-28 shrink-0" aria-hidden="true" />
          </div>
        </div>
      </footer>

      {/* Modals & Dialogs */}
      <WildColorPickerModal
        open={
          Boolean(pendingWildCard) ||
          (isMyTurn &&
            (view.turnPhase === 'AWAITING_INITIAL_WILD_COLOR' ||
              view.turnPhase === 'AWAITING_ROULETTE_COLOR'))
        }
        title={
          view.turnPhase === 'AWAITING_ROULETTE_COLOR'
            ? 'Wild Color Roulette: Choose Target Suit!'
            : view.turnPhase === 'AWAITING_INITIAL_WILD_COLOR'
              ? 'First Card is Wild: Select Initial Color'
              : 'Wild Card Played: Choose Color'
        }
        subtitle={
          view.turnPhase === 'AWAITING_ROULETTE_COLOR'
            ? 'You will flip cards from the deck until a card of your chosen suit color appears!'
            : 'Select the suit color and symbol to set as active'
        }
        onSelectColor={handleWildColorSelected}
        onCancel={pendingWildCard ? () => setPendingWildCard(null) : undefined}
      />

      <SwapTargetModal
        open={isMyTurn && view.turnPhase === 'AWAITING_SWAP_TARGET'}
        opponents={view.opponents}
        onSelectTarget={(targetPlayerId) =>
          onDispatchAction({
            type: 'CHOOSE_SWAP_TARGET',
            targetPlayerId,
          })
        }
      />

      <Wd4ChallengeModal
        open={isMyTurn && view.turnPhase === 'AWAITING_WD4_CHALLENGE'}
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

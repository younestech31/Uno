'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  FastForward,
  Film,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import {
  createGame,
  reduce,
  type GameAction,
  type GameState,
} from '@cardclash/engine';
import type { ReplayDataBundle } from '@cardclash/protocol';
import { CardGraphic } from '@/components/card-graphic';

export interface ReplayViewerModalProps {
  readonly matchId: string;
  readonly initialData?: ReplayDataBundle | null;
  readonly onClose: () => void;
}

export const ReplayViewerModal: React.FC<ReplayViewerModalProps> = ({
  matchId,
  initialData,
  onClose,
}) => {
  const [replayData, setReplayData] = useState<ReplayDataBundle | null>(
    initialData ?? null
  );
  const [loading, setLoading] = useState<boolean>(!initialData);
  const [error, setError] = useState<string | null>(null);

  const [stepIndex, setStepIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initialData) {
      setReplayData(initialData);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    fetch(`/api/matches/${matchId}/replay`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load replay (HTTP ${res.status})`);
        }
        return res.json() as Promise<ReplayDataBundle>;
      })
      .then((data) => {
        if (active) {
          setReplayData(data);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (active) {
          setError(err?.message ?? 'Failed to load replay data');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [matchId, initialData]);

  // Deterministically compute all states turn-by-turn using pure engine
  const stepStates = useMemo(() => {
    if (!replayData) return [];

    const states: {
      readonly state: GameState;
      readonly actionDescription: string;
      readonly events: readonly string[];
    }[] = [];

    const initialState = createGame({
      matchId: replayData.matchId,
      seed: replayData.seed,
      players: replayData.players.map((p) => ({ id: p.id, name: p.name })),
      houseRules: replayData.houseRules,
      targetScore: replayData.targetScore,
    });

    states.push({
      state: initialState,
      actionDescription: 'Match started • Cards dealt',
      events: ['Game initialized'],
    });

    let currentState = initialState;
    const playerNames = new Map(replayData.players.map((p) => [p.id, p.name]));

    for (let i = 0; i < replayData.actions.length; i++) {
      const entry = replayData.actions[i]!;
      const act = entry.action;
      const actorName = playerNames.get(act.playerId ?? '') ?? act.playerId ?? 'Player';

      let desc = `${actorName}: `;
      switch (act.type) {
        case 'PLAY_CARD':
          desc += `Played card ${act.cardId}${act.chosenColor ? ` (color: ${act.chosenColor})` : ''}${act.callUno ? ' [UNO!]' : ''}`;
          break;
        case 'DRAW_CARD':
          desc += 'Drew a card from deck';
          break;
        case 'PASS_TURN':
          desc += 'Passed turn';
          break;
        case 'CALL_UNO':
          desc += 'Shouted UNO!';
          break;
        case 'CATCH_UNO':
          desc += `Called Catch UNO on ${act.targetPlayerId ? playerNames.get(act.targetPlayerId) ?? act.targetPlayerId : 'opponent'}`;
          break;
        case 'CHOOSE_INITIAL_COLOR':
          desc += `Selected initial color ${act.color}`;
          break;
        case 'CHOOSE_SWAP_TARGET':
          desc += `Swapped hands with ${playerNames.get(act.targetPlayerId) ?? act.targetPlayerId}`;
          break;
        case 'CHALLENGE_WILD_DRAW_FOUR':
          desc += 'Challenged Wild Draw Four!';
          break;
        case 'ACCEPT_WILD_DRAW_FOUR':
          desc += 'Accepted Wild Draw Four penalty';
          break;
        case 'START_NEXT_ROUND':
          desc += 'Started next round';
          break;
        default:
          desc += `Action ${(act as any).type}`;
      }

      const engineAction: GameAction = {
        ...(act as any),
        playerId: act.playerId ?? replayData.players[0]?.id ?? '',
      };

      const result = reduce(currentState, engineAction);
      if (result.ok) {
        currentState = result.state;
        const evDesc = result.events.map((e) => e.type);
        states.push({
          state: currentState,
          actionDescription: desc,
          events: evDesc,
        });
      } else {
        break;
      }
    }

    return states;
  }, [replayData]);

  const maxSteps = Math.max(0, stepStates.length - 1);
  const currentStepData = stepStates[stepIndex] ?? stepStates[0];
  const currentState = currentStepData?.state;
  const topDiscard = currentState?.discardPile[currentState.discardPile.length - 1] ?? null;

  // Auto playback interval
  useEffect(() => {
    if (!isPlaying) {
      if (playTimerRef.current) {
        clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
      return;
    }

    if (stepIndex >= maxSteps) {
      setIsPlaying(false);
      return;
    }

    const intervalMs = Math.max(150, 1000 / playbackSpeed);
    playTimerRef.current = setTimeout(() => {
      setStepIndex((prev) => {
        if (prev >= maxSteps) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => {
      if (playTimerRef.current) {
        clearTimeout(playTimerRef.current);
        playTimerRef.current = null;
      }
    };
  }, [isPlaying, stepIndex, maxSteps, playbackSpeed]);

  const handleSeek = (newStep: number) => {
    const clamped = Math.max(0, Math.min(maxSteps, newStep));
    setStepIndex(clamped);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      if (stepIndex >= maxSteps) {
        setStepIndex(0);
      }
      setIsPlaying(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden text-white">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-950/80 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-400">
              <Film className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold flex items-center gap-2">
                Deterministic Match Replay
                {replayData && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                    Room {replayData.roomCode}
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">
                Authoritative frame-by-frame engine playback
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
              <RotateCcw className="w-8 h-8 animate-spin text-indigo-400" />
              <p className="text-sm">Loading match action log & seed...</p>
            </div>
          )}

          {error && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm">
              {error}
            </div>
          )}

          {replayData && currentState && (
            <div className="space-y-4">
              {/* Table Arena Preview */}
              <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 relative overflow-hidden">
                {/* Center Discard / Active Status */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  {/* Top Discard Card */}
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] uppercase font-bold text-slate-400 mb-1">
                        Top Discard
                      </span>
                      {topDiscard ? (
                        <div className="transform scale-90">
                          <CardGraphic card={topDiscard} size="sm" />
                        </div>
                      ) : (
                        <div className="w-16 h-24 rounded-lg border border-dashed border-slate-700 flex items-center justify-center text-xs text-slate-500">
                          None
                        </div>
                      )}
                    </div>

                    <div className="space-y-1 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">Current Color:</span>
                        <span
                          className={`font-bold uppercase px-2 py-0.5 rounded text-[11px] ${
                            currentState.currentColor === 'RED'
                              ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                              : currentState.currentColor === 'YELLOW'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : currentState.currentColor === 'GREEN'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : currentState.currentColor === 'BLUE'
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {currentState.currentColor ?? 'None'}
                        </span>
                      </div>
                      <div className="text-slate-400">
                        Direction:{' '}
                        <span className="text-white font-semibold">
                          {currentState.direction === 1
                            ? 'Clockwise ↻'
                            : 'Counter-Clockwise ↺'}
                        </span>
                      </div>
                      <div className="text-slate-400">
                        Round:{' '}
                        <span className="text-white font-semibold">
                          {currentState.roundNumber}
                        </span>
                      </div>
                      <div className="text-slate-400">
                        Draw Deck:{' '}
                        <span className="text-white font-semibold font-mono">
                          {currentState.drawPile.length} cards
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Active Player Banner */}
                  <div className="text-center sm:text-right">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      Active Turn
                    </span>
                    <div className="text-sm font-bold text-indigo-300 flex items-center justify-center sm:justify-end gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      {currentState.players[currentState.currentPlayerIndex]?.name ??
                        'None'}
                    </div>
                    <div className="text-xs text-slate-400 mt-1">
                      Phase: {currentState.turnPhase}
                    </div>
                  </div>
                </div>

                {/* Players Hands / Scores Grid */}
                <div className="mt-4 pt-4 border-t border-slate-800/80 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {currentState.players.map((p, idx) => {
                    const isActive = idx === currentState.currentPlayerIndex;
                    return (
                      <div
                        key={p.id}
                        className={`p-2.5 rounded-lg border transition ${
                          isActive
                            ? 'bg-indigo-950/40 border-indigo-500/50 text-white shadow-sm'
                            : 'bg-slate-900/60 border-slate-800 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold truncate max-w-[90px]">
                            {p.name}
                          </span>
                          {p.calledUno && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500 text-slate-950 font-bold">
                              UNO
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                          <span>Cards: {p.hand.length}</span>
                          <span>Score: {p.score}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Current Action Description Box */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-indigo-400 font-bold">
                    Turn {stepIndex} / {maxSteps}
                  </span>
                  <span className="text-slate-500">•</span>
                  <span className="text-slate-200 font-medium">
                    {currentStepData?.actionDescription}
                  </span>
                </div>
                {currentState.status === 'MATCH_OVER' && (
                  <div className="flex items-center gap-1 text-emerald-400 font-bold text-xs bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <Trophy className="w-3.5 h-3.5" />
                    Match Over! Winner:{' '}
                    {currentState.players.find(
                      (p) => p.id === currentState.matchWinnerId
                    )?.name ?? 'Winner'}
                  </div>
                )}
              </div>

              {/* Interactive Scrubber & Timeline Bar */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>Start (Turn 0)</span>
                  <span className="font-mono text-white font-semibold">
                    Turn {stepIndex} of {maxSteps}
                  </span>
                  <span>End (Turn {maxSteps})</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={maxSteps}
                  value={stepIndex}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition"
                />
              </div>

              {/* Playback Controls Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                {/* Transport Buttons */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <button
                    onClick={() => handleSeek(0)}
                    disabled={stepIndex === 0}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-300 transition"
                    title="Jump to Start"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleSeek(stepIndex - 1)}
                    disabled={stepIndex === 0}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-300 transition"
                    title="Step Backward"
                  >
                    <FastForward className="w-4 h-4 transform rotate-180" />
                  </button>

                  <button
                    onClick={handleTogglePlay}
                    className={`px-4 py-2 rounded-lg font-bold text-xs sm:text-sm flex items-center gap-1.5 transition shadow-lg ${
                      isPlaying
                        ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="w-4 h-4" /> Pause
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" /> Play
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleSeek(stepIndex + 1)}
                    disabled={stepIndex >= maxSteps}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-300 transition"
                    title="Step Forward"
                  >
                    <FastForward className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => handleSeek(maxSteps)}
                    disabled={stepIndex >= maxSteps}
                    className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800 text-slate-300 transition"
                    title="Jump to End"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                {/* Speed Controls */}
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                  {[0.5, 1, 2, 4].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => setPlaybackSpeed(speed)}
                      className={`px-2 py-1 rounded font-mono font-semibold transition ${
                        playbackSpeed === speed
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

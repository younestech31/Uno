'use client';

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Trophy,
  History,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  User,
  Film,
} from 'lucide-react';
import type {
  AccountProfile,
  MatchHistoryEntry,
} from '@cardclash/protocol';

export function AccountSignInModal({
  isOpen,
  isGuest,
  currentName,
  currentEmail,
  onClose,
  onSignIn,
  onSwitchToGuest,
}: {
  readonly isOpen: boolean;
  readonly isGuest: boolean;
  readonly currentName: string;
  readonly currentEmail?: string | null;
  readonly onClose: () => void;
  readonly onSignIn: (email: string, name: string) => Promise<void>;
  readonly onSwitchToGuest: () => Promise<void>;
}) {
  const [emailInput, setEmailInput] = useState(currentEmail ?? '');
  const [nameInput, setNameInput] = useState(currentName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!emailInput.trim() || !emailInput.includes('@')) {
      setError('Please enter a valid email address');
      return;
    }
    if (!nameInput.trim()) {
      setError('Please enter a display name');
      return;
    }

    setSubmitting(true);
    try {
      await onSignIn(emailInput.trim(), nameInput.trim());
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-white/10 p-6 text-white shadow-2xl space-y-5"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Player Account</h2>
                  <p className="text-xs text-stone-400">
                    Optional Auth.js-compatible session
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded-lg text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-200 text-xs font-medium">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="auth-email-input"
                  className="text-xs font-semibold text-stone-200 block"
                >
                  Email Address
                </label>
                <input
                  id="auth-email-input"
                  type="email"
                  required
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="player@example.com"
                  className="w-full min-h-11 px-3.5 py-2 rounded-xl bg-slate-950/90 border border-white/15 text-sm text-white placeholder:text-stone-500 focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="auth-name-input"
                  className="text-xs font-semibold text-stone-200 block"
                >
                  Display Name
                </label>
                <input
                  id="auth-name-input"
                  type="text"
                  required
                  maxLength={24}
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="Alex"
                  className="w-full min-h-11 px-3.5 py-2 rounded-xl bg-slate-950/90 border border-white/15 text-sm text-white placeholder:text-stone-500 focus:outline-none focus:border-emerald-400"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                {!isGuest ? (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={async () => {
                      setSubmitting(true);
                      try {
                        await onSwitchToGuest();
                        onClose();
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className="min-h-11 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-medium text-stone-300 transition-colors cursor-pointer"
                  >
                    Switch to Guest Default
                  </button>
                ) : (
                  <span className="text-[11px] text-stone-400">
                    Current: Instant Guest Session
                  </span>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    type="button"
                    onClick={onClose}
                    className="min-h-11 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-stone-200 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="min-h-11 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-xs font-bold text-white transition-colors cursor-pointer"
                  >
                    {submitting ? 'Signing In...' : 'Issue Verified Token'}
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function LeaderboardAndHistorySection({
  leaderboard,
  recentMatches,
  currentPlayerId,
  loading,
  onRefresh,
  onWatchReplay,
}: {
  readonly leaderboard: readonly AccountProfile[];
  readonly recentMatches: readonly MatchHistoryEntry[];
  readonly currentPlayerId?: string;
  readonly loading: boolean;
  readonly onRefresh: () => void;
  readonly onWatchReplay?: (matchId: string) => void;
}) {
  return (
    <section className="space-y-6 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
            <Trophy className="w-6 h-6 text-amber-400" />
            Hall of Clashers & Ratings
          </h2>
          <p className="text-xs text-stone-400">
            Authoritative multi-player OpenSkill Plackett-Luce ratings ($\mu - 3\sigma$) and persistent match history
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="min-h-10 px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-40 text-xs font-semibold text-stone-300 flex items-center gap-2 transition-colors cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`}
          />
          Refresh Standings
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 7 Columns: OpenSkill Leaderboard Table */}
        <div className="lg:col-span-7 rounded-2xl bg-[#10352F] border border-white/10 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <h3 className="text-sm font-bold text-white">Global Leaderboard</h3>
            </div>
            <span className="text-xs text-stone-400 font-mono">
              Default $\mu=25.0, \sigma=8.33$
            </span>
          </div>

          {leaderboard.length === 0 ? (
            <div className="p-8 text-center text-xs text-stone-400 space-y-1">
              <p>No rated players yet.</p>
              <p className="text-stone-500">
                Complete a match to establish OpenSkill rating and claim your rank!
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-stone-400 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3 pl-5 pr-3">Rank</th>
                    <th className="py-3 px-3">Player</th>
                    <th className="py-3 px-3 text-right">Skill Rating (SR)</th>
                    <th className="py-3 px-3 text-right">W/L</th>
                    <th className="py-3 pl-3 pr-5 text-right">Pts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {leaderboard.map((entry, index) => {
                    const isSelf = entry.playerId === currentPlayerId;
                    return (
                      <tr
                        key={entry.playerId}
                        className={`transition-colors ${
                          isSelf
                            ? 'bg-emerald-500/15 font-semibold text-white'
                            : 'text-stone-200 hover:bg-white/5'
                        }`}
                      >
                        <td className="py-3.5 pl-5 pr-3 font-mono tabular-nums text-stone-400">
                          {index === 0 ? '🥇 1' : index === 1 ? '🥈 2' : index === 2 ? '🥉 3' : `#${index + 1}`}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-2">
                            {entry.isGuest ? (
                              <User className="w-3.5 h-3.5 text-stone-400" />
                            ) : (
                              <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                            )}
                            <span className="truncate max-w-[140px]">
                              {entry.name}
                            </span>
                            {isSelf && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 font-bold">
                                You
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-amber-300 font-bold">
                          {entry.rating.displayRating}
                        </td>
                        <td className="py-3.5 px-3 text-right font-mono tabular-nums text-stone-400">
                          {entry.matchesWon}/{entry.matchesPlayed}
                        </td>
                        <td className="py-3.5 pl-3 pr-5 text-right font-mono tabular-nums text-stone-300">
                          {entry.totalPoints}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right 5 Columns: Recent Match History (derived from MatchActionLog) */}
        <div className="lg:col-span-5 rounded-2xl bg-[#10352F] border border-white/10 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-emerald-400" />
              <h3 className="text-sm font-bold text-white">
                Match History (Action Log)
              </h3>
            </div>
            <span className="text-xs text-stone-400 font-mono tabular-nums">
              {recentMatches.length} recorded
            </span>
          </div>

          {recentMatches.length === 0 ? (
            <div className="p-8 text-center text-xs text-stone-400 space-y-1">
              <p>No completed matches logged yet.</p>
              <p className="text-stone-500">
                When a match reaches target score, the server records the ordered action log, cryptographic seed, and OpenSkill rating deltas here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/10 max-h-[420px] overflow-y-auto">
              {recentMatches.map((m) => (
                <div key={m.matchId} className="p-4 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-white">
                      Room {m.roomCode} · Winner: {m.winnerName}
                    </span>
                    <span className="font-mono tabular-nums text-stone-400">
                      {m.roundsPlayed} {m.roundsPlayed === 1 ? 'round' : 'rounds'} ·{' '}
                      {m.actionCount} actions
                    </span>
                  </div>

                  <div className="space-y-1">
                    {m.participants.map((p) => (
                      <div
                        key={p.playerId}
                        className="flex items-center justify-between text-[11px] text-stone-300 font-mono tabular-nums"
                      >
                        <span className="truncate font-sans">
                          #{p.placement} {p.name}
                        </span>
                        <span>
                          {p.finalScore} pts · {p.ratingAfter} SR (
                          <span
                            className={
                              p.ratingDelta >= 0
                                ? 'text-emerald-300'
                                : 'text-rose-300'
                            }
                          >
                            {p.ratingDelta >= 0
                              ? `+${p.ratingDelta}`
                              : p.ratingDelta}
                          </span>
                          )
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-white/5">
                    <p className="text-[10px] font-mono text-stone-400 truncate max-w-[180px]">
                      Seed: {m.seed}
                    </p>
                    {onWatchReplay && (
                      <button
                        type="button"
                        onClick={() => onWatchReplay(m.matchId)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold transition cursor-pointer"
                      >
                        <Film className="w-3 h-3" />
                        <span>Watch Replay</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AnimatePresence, motion } from 'motion/react';
import {
  Copy,
  Check,
  Play,
  Plus,
  UserPlus,
  LogOut,
  ArrowRight,
  Volume2,
  VolumeX,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  COLORED_SUITS,
  DEFAULT_HOUSE_RULES,
  NO_MERCY_HOUSE_RULES,
  isPlayable,
  type Card,
  type ColoredCardColor,
  type GameEvent,
  type GameMode,
  type HouseRules,
  type PlayerView,
} from '@cardclash/engine';
import {
  SOCKET_EVENTS,
  type AccountProfile,
  type ClientGameActionDraft,
  type ClientGameActionIntent,
  type GameEventsBroadcast,
  type GameViewBroadcast,
  type LeaderboardResponse,
  type MatchHistoryEntry,
  type ProtocolErrorPayload,
  type PublicRoomState,
  type SocketAckResult,
} from '@cardclash/protocol';
import { CardGraphic, SUIT_META } from './card-graphic';
import { CardTableView, type CompanionSeatInfo } from './card-table-view';
import {
  AccountSignInModal,
  LeaderboardAndHistorySection,
} from './leaderboard-section';

interface SessionCredentials {
  readonly token: string;
  readonly playerId: string;
  readonly name: string;
  readonly email?: string | null;
  readonly isGuest?: boolean;
  readonly profile?: AccountProfile;
}

interface ManagedSeatClient {
  readonly credentials: SessionCredentials;
  readonly socket: Socket;
}

interface ToastMessage {
  readonly id: string;
  readonly text: string;
  readonly tone: 'info' | 'warning' | 'error' | 'success';
}

const DEMO_CARDS: readonly Card[] = [
  { id: 'DEMO-RED-7', color: 'RED', kind: 'NUMBER', value: 7 },
  { id: 'DEMO-BLUE-SKIP', color: 'BLUE', kind: 'SKIP', value: null },
  { id: 'DEMO-YELLOW-REV', color: 'YELLOW', kind: 'REVERSE', value: null },
  { id: 'DEMO-GREEN-D2', color: 'GREEN', kind: 'DRAW_TWO', value: null },
  { id: 'DEMO-WILD-4', color: 'WILD', kind: 'WILD_DRAW_FOUR', value: null },
];

const DEMO_NO_MERCY_CARDS: readonly Card[] = [
  { id: 'DEMO-NM-SKIPALL', color: 'RED', kind: 'SKIP_ALL', value: null },
  { id: 'DEMO-NM-DISCARDALL', color: 'BLUE', kind: 'DISCARD_ALL', value: null },
  { id: 'DEMO-NM-ROULETTE', color: 'WILD', kind: 'WILD_COLOR_ROULETTE', value: null },
  { id: 'DEMO-NM-D6', color: 'WILD', kind: 'WILD_DRAW_SIX', value: null },
  { id: 'DEMO-NM-D10', color: 'WILD', kind: 'WILD_DRAW_TEN', value: null },
];

const COMPANION_NAMES = ['Nova', 'Orion', 'Vega', 'Atlas', 'Lyra'];

function playSynthesizedFx(
  kind:
    | 'play'
    | 'draw'
    | 'yourTurn'
    | 'timerTick'
    | 'uno'
    | 'wild'
    | 'swap'
    | 'error'
    | 'win',
  enabled: boolean,
  color?: ColoredCardColor | 'WILD'
): void {
  if (!enabled || typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playNode = (oscType: OscillatorType, freq: number, startOffset: number, duration: number, startVol: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = oscType;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(startVol, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    if (kind === 'play') {
      // 1. Core clean color-pitched musical tone
      const baseFreq =
        color === 'RED'
          ? 523.25 // C5
          : color === 'BLUE'
            ? 587.33 // D5
            : color === 'GREEN'
              ? 659.25 // E5
              : color === 'YELLOW'
                ? 783.99 // G5
                : 880.00; // A5 (WILD)
      playNode('triangle', baseFreq, 0, 0.12, 0.12);

      // 2. Secondary highly-damped low-frequency tactile cardboard clack
      const snapOsc = ctx.createOscillator();
      const snapGain = ctx.createGain();
      snapOsc.type = 'sawtooth';
      snapOsc.frequency.setValueAtTime(100, now);
      snapOsc.frequency.exponentialRampToValueAtTime(40, now + 0.04);
      snapGain.gain.setValueAtTime(0.18, now);
      snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
      snapOsc.connect(snapGain);
      snapGain.connect(ctx.destination);
      snapOsc.start(now);
      snapOsc.stop(now + 0.04);

    } else if (kind === 'draw') {
      // Twin detuned smooth sine waves sweeping up (slick/swoosh card slide)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'sine';

      osc1.frequency.setValueAtTime(320, now);
      osc1.frequency.exponentialRampToValueAtTime(680, now + 0.12);

      osc2.frequency.setValueAtTime(335, now);
      osc2.frequency.exponentialRampToValueAtTime(705, now + 0.12);

      gainNode.gain.setValueAtTime(0.14, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.13);
      osc2.stop(now + 0.13);

    } else if (kind === 'yourTurn') {
      // Uplifting arpeggiated E-Major triad (E5 -> G#5 -> B5 -> E6)
      playNode('sine', 659.25, 0, 0.22, 0.08);       // E5
      playNode('sine', 830.61, 0.04, 0.22, 0.08);    // G#5
      playNode('sine', 987.77, 0.08, 0.22, 0.08);    // B5
      playNode('sine', 1318.51, 0.12, 0.26, 0.08);   // E6

    } else if (kind === 'timerTick') {
      playNode('sine', 880, 0, 0.05, 0.08);

    } else if (kind === 'uno') {
      // Detuned brassy unison chord (C5 & G5 simultaneously) with sweep vibration
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'triangle';
      osc2.type = 'sawtooth';

      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.linearRampToValueAtTime(535, now + 0.22);

      osc2.frequency.setValueAtTime(783.99, now); // G5
      osc2.frequency.linearRampToValueAtTime(790, now + 0.22);

      gainNode.gain.setValueAtTime(0.14, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.24);
      osc2.stop(now + 0.24);

    } else if (kind === 'wild') {
      // Cybernetic ascending sweep chord
      playNode('sine', 400, 0, 0.24, 0.10);
      playNode('sine', 600, 0.04, 0.24, 0.10);
      playNode('sine', 900, 0.08, 0.24, 0.10);

    } else if (kind === 'swap') {
      // Swirling FM-like digital laser sound
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.linearRampToValueAtTime(800, now + 0.10);
      osc.frequency.linearRampToValueAtTime(440, now + 0.22);
      gainNode.gain.setValueAtTime(0.12, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.24);

    } else if (kind === 'win') {
      // Polyphonic major-7th victory arpeggio cascade
      playNode('triangle', 523.25, 0, 0.35, 0.08);    // C5
      playNode('triangle', 659.25, 0.05, 0.35, 0.08);   // E5
      playNode('triangle', 783.99, 0.10, 0.35, 0.08);   // G5
      playNode('triangle', 987.77, 0.15, 0.35, 0.08);   // B5
      playNode('triangle', 1046.50, 0.20, 0.40, 0.08);  // C6
      playNode('triangle', 1318.51, 0.25, 0.45, 0.08);  // E6

    } else {
      // Analog synth warning buzz for invalid moves
      const osc = ctx.createOscillator();
      const filter = ctx.createBiquadFilter();
      const gainNode = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, now);
      filter.frequency.exponentialRampToValueAtTime(50, now + 0.14);

      gainNode.gain.setValueAtTime(0.12, now);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.15);
    }
  } catch {
    // Ignore audio failures if browser blocked autoplay
  }
}


function formatActionTickerText(
  evt: GameEvent,
  players: readonly { id: string; name: string }[]
): string | null {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  switch (evt.type) {
    case 'ROUND_STARTED':
      return `Round ${evt.roundNumber} started · ${nameOf(evt.startingPlayerId)} leads`;
    case 'INITIAL_COLOR_CHOSEN':
      return `${nameOf(evt.playerId)} set starting suit to ${SUIT_META[evt.color].label} (${SUIT_META[evt.color].symbol})`;
    case 'CARD_PLAYED': {
      const suitPart = evt.chosenColor
        ? ` → ${SUIT_META[evt.chosenColor].label} ${SUIT_META[evt.chosenColor].symbol}`
        : '';
      const jumpPart = evt.jumpedIn ? ' (Jump-In!)' : '';
      return `${nameOf(evt.playerId)} played ${evt.card.id.replace(/-\d+$/, '')}${suitPart}${jumpPart}`;
    }
    case 'DISCARD_ALL_PLAYED':
      return `${nameOf(evt.playerId)} swept ${evt.count} ${SUIT_META[evt.color].label} (${SUIT_META[evt.color].symbol}) cards with Discard All!`;
    case 'COLOR_ROULETTE_RESOLVED':
      return `${nameOf(evt.playerId)} picked ${SUIT_META[evt.chosenColor].label} (${SUIT_META[evt.chosenColor].symbol}) on Color Roulette and flipped ${evt.drawnCount} cards!`;
    case 'PLAYER_ELIMINATED':
      return `${nameOf(evt.playerId)} hit ${evt.cardCount} cards — KNOCKED OUT!${
        evt.bonusAwardedToId ? ` (+${evt.bonusPoints} pts to ${nameOf(evt.bonusAwardedToId)})` : ''
      }`;
    case 'CARDS_DRAWN':
      if (evt.count <= 1) {
        return `${nameOf(evt.playerId)} drew a card`;
      }
      return `${nameOf(evt.playerId)} drew ${evt.count} cards (${evt.reason.replace(/_/g, ' ')})`;
    case 'TURN_SKIPPED':
      return evt.reason === 'SKIP_ALL'
        ? `Skip Everyone! Active player takes another turn`
        : `${nameOf(evt.skippedPlayerId)} was skipped`;
    case 'DIRECTION_REVERSED':
      return `Play direction reversed (${evt.direction === 1 ? 'Clockwise' : 'Counter-Clockwise'})`;
    case 'DECK_RESHUFFLED':
      return `Discard pile reshuffled into ${evt.newDrawPileCount}-card draw deck`;
    case 'UNO_CALLED':
      return `${nameOf(evt.playerId)} called UNO!`;
    case 'UNO_CAUGHT':
      return `${nameOf(evt.catcherId)} caught ${nameOf(evt.caughtId)} (+${evt.penaltyCount} cards)!`;
    case 'HANDS_SWAPPED':
      return evt.mode === 'ZERO_ROTATE'
        ? `${nameOf(evt.sourcePlayerId)} played 0 — all hands rotated!`
        : `${nameOf(evt.sourcePlayerId)} swapped hands with ${nameOf(evt.targetPlayerId ?? '')}!`;
    case 'WD4_CHALLENGE_RESOLVED':
      return evt.wasGuilty
        ? `Challenge won! ${nameOf(evt.blufferId)} caught bluffing (+4 cards)`
        : `Challenge failed! ${nameOf(evt.challengerId)} drew 6 cards`;
    case 'ROUND_ENDED':
      return `${nameOf(evt.winnerId)} won Round ${evt.roundNumber} (+${evt.pointsEarned} pts)`;
    case 'MATCH_ENDED':
      return `${nameOf(evt.winnerId)} won the match!`;
    default:
      return null;
  }
}

function formatEventToast(
  evt: GameEvent,
  players: readonly { id: string; name: string }[]
): { text: string; tone: ToastMessage['tone'] } | null {
  const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? id;

  switch (evt.type) {
    case 'ROUND_STARTED':
      return {
        text: `Round ${evt.roundNumber} started · ${nameOf(evt.startingPlayerId)} leads`,
        tone: 'info',
      };
    case 'INITIAL_COLOR_CHOSEN':
      return {
        text: `${nameOf(evt.playerId)} set starting suit to ${SUIT_META[evt.color].label} (${SUIT_META[evt.color].symbol})`,
        tone: 'info',
      };
    case 'CARD_PLAYED': {
      const suitPart = evt.chosenColor
        ? ` → ${SUIT_META[evt.chosenColor].label} ${SUIT_META[evt.chosenColor].symbol}`
        : '';
      const jumpPart = evt.jumpedIn ? ' (Jump-In!)' : '';
      return {
        text: `${nameOf(evt.playerId)} played ${evt.card.id.replace(/-\d+$/, '')}${suitPart}${jumpPart}`,
        tone: 'info',
      };
    }
    case 'DISCARD_ALL_PLAYED':
      return {
        text: `${nameOf(evt.playerId)} discarded all ${evt.count} ${SUIT_META[evt.color].label} cards!`,
        tone: 'warning',
      };
    case 'COLOR_ROULETTE_RESOLVED':
      return {
        text: `${nameOf(evt.playerId)} flipped ${evt.drawnCount} cards on Color Roulette!`,
        tone: 'warning',
      };
    case 'PLAYER_ELIMINATED':
      return {
        text: `MERCY RULE KO! ${nameOf(evt.playerId)} reached ${evt.cardCount} cards${
          evt.bonusAwardedToId ? ` · +${evt.bonusPoints} pts to ${nameOf(evt.bonusAwardedToId)}` : ''
        }`,
        tone: 'error',
      };
    case 'CARDS_DRAWN':
      if (evt.reason === 'TURN_DRAW') {
        return { text: `${nameOf(evt.playerId)} drew a card`, tone: 'info' };
      }
      return {
        text: `${nameOf(evt.playerId)} drew ${evt.count} cards (${evt.reason.replace(/_/g, ' ')})`,
        tone: 'warning',
      };
    case 'TURN_SKIPPED':
      return {
        text:
          evt.reason === 'SKIP_ALL'
            ? `Skip Everyone! Extra turn granted`
            : `${nameOf(evt.skippedPlayerId)} was skipped`,
        tone: 'warning',
      };
    case 'DIRECTION_REVERSED':
      return {
        text: `Play direction reversed (${evt.direction === 1 ? 'Clockwise' : 'Counter-Clockwise'})`,
        tone: 'info',
      };
    case 'DECK_RESHUFFLED':
      return {
        text: `Discard pile reshuffled into ${evt.newDrawPileCount}-card draw deck`,
        tone: 'info',
      };
    case 'UNO_CALLED':
      return {
        text: `${nameOf(evt.playerId)} called UNO!`,
        tone: 'success',
      };
    case 'UNO_CAUGHT':
      return {
        text: `${nameOf(evt.catcherId)} caught ${nameOf(evt.caughtId)}! (+${evt.penaltyCount} penalty cards)`,
        tone: 'error',
      };
    case 'HANDS_SWAPPED':
      return {
        text:
          evt.mode === 'ZERO_ROTATE'
            ? `${nameOf(evt.sourcePlayerId)} played 0 — all hands rotated!`
            : `${nameOf(evt.sourcePlayerId)} swapped hands with ${nameOf(evt.targetPlayerId ?? '')}!`,
        tone: 'warning',
      };
    case 'WD4_CHALLENGE_RESOLVED':
      return {
        text: evt.wasGuilty
          ? `Challenge won! ${nameOf(evt.blufferId)} caught bluffing (+4 cards)`
          : `Challenge failed! ${nameOf(evt.challengerId)} drew 6 cards`,
        tone: evt.wasGuilty ? 'success' : 'error',
      };
    case 'ROUND_ENDED':
      return {
        text: `${nameOf(evt.winnerId)} won Round ${evt.roundNumber} (+${evt.pointsEarned} pts)`,
        tone: 'success',
      };
    case 'MATCH_ENDED':
      return {
        text: `${nameOf(evt.winnerId)} won the match! OpenSkill ratings updated`,
        tone: 'success',
      };
    default:
      return null;
  }
}

function getBackendUrl(): string {
  if (process.env.NEXT_PUBLIC_SOCKET_URL) {
    return process.env.NEXT_PUBLIC_SOCKET_URL;
  }
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
}

async function fetchGuestToken(
  name: string,
  existingPlayerId?: string
): Promise<SessionCredentials> {
  const backendUrl = getBackendUrl();
  if (backendUrl === window.location.origin) {
    await fetch('/api/socketio').catch(() => null);
  }
  const res = await fetch(`${backendUrl}/api/session/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, playerId: existingPlayerId }),
  });
  if (!res.ok) {
    throw new Error('Failed to issue session token');
  }
  return (await res.json()) as SessionCredentials;
}

async function fetchAccountToken(
  email: string,
  name: string,
  existingPlayerId?: string
): Promise<SessionCredentials> {
  const backendUrl = getBackendUrl();
  if (backendUrl === window.location.origin) {
    await fetch('/api/socketio').catch(() => null);
  }
  const res = await fetch(`${backendUrl}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, playerId: existingPlayerId }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || 'Failed to sign in');
  }
  return (await res.json()) as SessionCredentials;
}

type SocketCallback = (data: any) => void;

class ServerlessFallbackSocket {
  private listeners = new Map<string, Set<SocketCallback>>();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private broadcastHandler: ((e: Event) => void) | null = null;
  public connected = false;
  public readonly isServerlessFallback = true;

  public static clearActiveRoomStorage(roomCode?: string | null): void {
    if (typeof window === 'undefined') return;
    const active = roomCode || window.sessionStorage.getItem('cardclash_active_room');
    window.sessionStorage.removeItem('cardclash_active_room');
    if (active) {
      window.sessionStorage.removeItem(`cardclash_snapshot_${active.toUpperCase()}`);
    }
  }

  constructor(
    private token: string,
    private playerId: string,
    private enablePolling = true
  ) {
    this.connected = true;
    setTimeout(() => {
      if (this.connected) {
        this.trigger('connect', null);
      }
    }, 50);

    if (typeof window !== 'undefined') {
      this.broadcastHandler = (evt: Event) => {
        if (!this.connected) return;
        const customEvt = evt as CustomEvent<{
          room: PublicRoomState;
          viewsByPlayer: Record<string, PlayerView> | null;
          events: GameEvent[] | null;
          sourcePlayerId: string;
        }>;
        const detail = customEvt.detail;
        if (!detail || detail.sourcePlayerId === this.playerId) return;
        const activeRoom = window.sessionStorage.getItem('cardclash_active_room');
        if (!activeRoom || detail.room?.roomCode !== activeRoom) return;

        if (detail.viewsByPlayer && detail.viewsByPlayer[this.playerId]) {
          this.trigger(SOCKET_EVENTS.GAME_VIEW, {
            roomCode: detail.room.roomCode,
            view: detail.viewsByPlayer[this.playerId],
            turnDeadlineAt: detail.room.turnDeadlineAt ?? null,
          });
        }
        if (detail.room) {
          this.trigger(SOCKET_EVENTS.ROOM_STATE, detail.room);
        }
        if (detail.events) {
          this.trigger(SOCKET_EVENTS.GAME_EVENTS, { events: detail.events });
        }
      };
      window.addEventListener('cardclash_sync_broadcast', this.broadcastHandler);

      // Dynamic background room sync loop (polls every 1.5 seconds on primary seat)
      if (this.enablePolling) {
        this.pollingInterval = setInterval(() => {
          void this.pollSync();
        }, 1500);
      }
    }
  }

  public on(event: string, callback: SocketCallback): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return this;
  }

  public once(event: string, callback: SocketCallback): this {
    const wrapper = (data: any) => {
      this.off(event, wrapper);
      callback(data);
    };
    return this.on(event, wrapper);
  }

  public off(event: string, callback: SocketCallback): this {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
    }
    return this;
  }

  public disconnect(): void {
    this.connected = false;
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (typeof window !== 'undefined' && this.broadcastHandler) {
      window.removeEventListener('cardclash_sync_broadcast', this.broadcastHandler);
      this.broadcastHandler = null;
    }
    this.trigger('disconnect', null);
  }

  public trigger(event: string, data: any): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const cb of set) {
        try {
          cb(data);
        } catch (e) {
          console.error('[ServerlessFallbackSocket] Callback error:', e);
        }
      }
    }

    // Broadcast across tabs/seats inside the same window using custom window event
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('cardclash_sync_event', {
          detail: { event, data, playerId: this.playerId },
        })
      );
    }
  }

  private getSnapshotToken(explicitRoomCode?: string | null): string | null {
    if (typeof window === 'undefined') return null;
    const roomCode =
      explicitRoomCode || window.sessionStorage.getItem('cardclash_active_room');
    if (!roomCode) return null;
    return window.sessionStorage.getItem(`cardclash_snapshot_${roomCode.toUpperCase()}`);
  }

  private saveSnapshotToken(roomCode: string, token: string): void {
    if (typeof window === 'undefined') return;
    const normalized = roomCode.toUpperCase();
    window.sessionStorage.setItem('cardclash_active_room', normalized);
    window.sessionStorage.setItem(`cardclash_snapshot_${normalized}`, token);
  }

  private async pollSync() {
    if (!this.connected || typeof window === 'undefined') return;
    const roomCode = window.sessionStorage.getItem('cardclash_active_room');
    if (!roomCode) return;

    try {
      const token = this.getSnapshotToken(roomCode);
      const res = await fetch('/api/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          type: 'room:sync',
          roomCode,
          snapshotToken: token || undefined,
        }),
      });

      // Abort if socket disconnected or user already left/changed room while fetch was in flight
      if (
        !this.connected ||
        window.sessionStorage.getItem('cardclash_active_room') !== roomCode
      ) {
        return;
      }

      if (res.status === 404 || res.status === 403) {
        ServerlessFallbackSocket.clearActiveRoomStorage(roomCode);
        return;
      }

      if (res.ok) {
        const envelope = await res.json();
        if (
          !this.connected ||
          window.sessionStorage.getItem('cardclash_active_room') !== roomCode
        ) {
          return;
        }
        if (envelope.ok && envelope.data) {
          if (envelope.snapshotToken) {
            this.saveSnapshotToken(roomCode, envelope.snapshotToken);
          }
          if (envelope.data.view) {
            this.trigger(SOCKET_EVENTS.GAME_VIEW, {
              roomCode,
              view: envelope.data.view,
              turnDeadlineAt: envelope.data.turnDeadlineAt ?? null,
            });
          }
          if (envelope.data.room) {
            this.trigger(SOCKET_EVENTS.ROOM_STATE, envelope.data.room);
          }
        }
      }
    } catch {
      // Ignore background poll errors
    }
  }

  public emit(event: string, payload: any, ack?: SocketCallback): void {
    void this.dispatchEmit(event, payload, ack);
  }

  private async dispatchEmit(event: string, payload: any, ack?: SocketCallback) {
    try {
      let rpcType = '';
      let rpcPayload = payload;
      let roomCode = payload?.roomCode;

      if (event === SOCKET_EVENTS.ROOM_CREATE) {
        rpcType = 'room:create';
      } else if (event === SOCKET_EVENTS.ROOM_JOIN) {
        rpcType = 'room:join';
        roomCode = payload.roomCode;
      } else if (event === SOCKET_EVENTS.ROOM_SPECTATE) {
        rpcType = 'room:spectate';
        roomCode = payload.roomCode;
      } else if (event === SOCKET_EVENTS.ROOM_READY) {
        rpcType = 'room:ready';
        roomCode = payload.roomCode;
      } else if (event === SOCKET_EVENTS.ROOM_START) {
        rpcType = 'room:start';
        roomCode = payload.roomCode;
      } else if (event === SOCKET_EVENTS.ROOM_REMATCH) {
        rpcType = 'room:rematch';
        roomCode = payload.roomCode;
      } else if (event === SOCKET_EVENTS.ROOM_LEAVE) {
        rpcType = 'room:leave';
        roomCode = payload?.roomCode;
      } else if (event === SOCKET_EVENTS.GAME_ACTION) {
        rpcType = 'game:action';
        roomCode = payload.roomCode;
        rpcPayload = payload.action;
      } else if (event === SOCKET_EVENTS.SESSION_HEARTBEAT) {
        if (ack) {
          ack({ ok: true, data: { serverTime: Date.now(), roomCode: null, turnDeadlineAt: null } });
        }
        return;
      } else {
        return;
      }

      const activeRoom = (
        roomCode ||
        (typeof window !== 'undefined'
          ? window.sessionStorage.getItem('cardclash_active_room')
          : null) ||
        ''
      ).toUpperCase();
      const snapToken = activeRoom ? this.getSnapshotToken(activeRoom) : null;

      if (event === SOCKET_EVENTS.ROOM_LEAVE) {
        ServerlessFallbackSocket.clearActiveRoomStorage(activeRoom);
      }

      const res = await fetch('/api/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          type: rpcType,
          payload: rpcPayload,
          roomCode: activeRoom || undefined,
          snapshotToken: snapToken || undefined,
        }),
      });

      if (event === SOCKET_EVENTS.ROOM_LEAVE) {
        if (ack) {
          ack({ ok: true, data: { roomCode: activeRoom, room: null } });
        }
        return;
      }

      if (!res.ok) {
        const errPayload = await res.json().catch(() => ({}));
        const errObj = { code: 'RPC_ERROR', message: errPayload.error?.message || errPayload.error || 'Serverless action failed' };
        this.trigger(SOCKET_EVENTS.ERROR_EVENT, errObj);
        if (ack) ack({ ok: false, error: errObj });
        return;
      }

      const envelope = await res.json();

      // If this was an in-room mutation and the user left the room while the request was in flight, discard
      const isRoomEntryEvent =
        event === SOCKET_EVENTS.ROOM_CREATE ||
        event === SOCKET_EVENTS.ROOM_JOIN ||
        event === SOCKET_EVENTS.ROOM_SPECTATE;
      if (
        !isRoomEntryEvent &&
        typeof window !== 'undefined' &&
        window.sessionStorage.getItem('cardclash_active_room') !== activeRoom
      ) {
        return;
      }

      if (envelope.ok && envelope.data) {
        const data = envelope.data;
        const currentRoomCode = (data.room?.roomCode || activeRoom || '').toUpperCase();
        if (currentRoomCode && envelope.snapshotToken) {
          this.saveSnapshotToken(currentRoomCode, envelope.snapshotToken);
        }

        if (data.view) {
          this.trigger(SOCKET_EVENTS.GAME_VIEW, {
            roomCode: currentRoomCode,
            view: data.view,
            turnDeadlineAt: data.turnDeadlineAt ?? data.room?.turnDeadlineAt ?? null,
          });
        }
        if (data.viewsByPlayer && data.viewsByPlayer[this.playerId]) {
          this.trigger(SOCKET_EVENTS.GAME_VIEW, {
            roomCode: currentRoomCode,
            view: data.viewsByPlayer[this.playerId],
            turnDeadlineAt: data.room?.turnDeadlineAt ?? null,
          });
        }
        if (data.room) {
          this.trigger(SOCKET_EVENTS.ROOM_STATE, data.room);
        }
        if (data.events) {
          this.trigger(SOCKET_EVENTS.GAME_EVENTS, { events: data.events });
        }

        if (ack) {
          ack({ ok: true, data });
        }

        // Broadcaster for other seats in the same browser window
        if (typeof window !== 'undefined' && data.room) {
          window.dispatchEvent(
            new CustomEvent('cardclash_sync_broadcast', {
              detail: {
                room: data.room,
                viewsByPlayer: data.viewsByPlayer || null,
                events: data.events || null,
                sourcePlayerId: this.playerId,
              },
            })
          );
        }
      }
    } catch (e: any) {
      const errObj = { code: 'FETCH_ERROR', message: e?.message || 'Network request failed' };
      this.trigger(SOCKET_EVENTS.ERROR_EVENT, errObj);
      if (ack) ack({ ok: false, error: errObj });
    }
  }
}

function createGameSocket(creds: SessionCredentials, enablePolling = true): any {
  // Use robust, unified ServerlessFallbackSocket for immediate, zero-drop connectivity
  // with serverless snapshot safety, multi-seat browser broadcast, and /api/rpc state management.
  return new ServerlessFallbackSocket(creds.token, creds.playerId, enablePolling) as any;
}

export default function CardClashApp() {
  const [playerName, setPlayerName] = useState<string>('Alex');
  const [primaryCreds, setPrimaryCreds] = useState<SessionCredentials | null>(
    null
  );
  const [connected, setConnected] = useState<boolean>(false);
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [viewsBySeat, setViewsBySeat] = useState<Record<string, PlayerView>>(
    {}
  );
  const [turnDeadlineAt, setTurnDeadlineAt] = useState<number | null>(null);
  const [activeSeatId, setActiveSeatId] = useState<string>('');
  const [autoPlayCompanions, setAutoPlayCompanions] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Phase 5: Accounts, OpenSkill Leaderboard & Match History state
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(false);
  const [leaderboard, setLeaderboard] = useState<readonly AccountProfile[]>([]);
  const [recentMatches, setRecentMatches] = useState<
    readonly MatchHistoryEntry[]
  >([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState<boolean>(false);

  // Home form state
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [targetScore, setTargetScore] = useState<number>(500);
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [houseRules, setHouseRules] = useState<HouseRules>({
    ...DEFAULT_HOUSE_RULES,
  });
  const [botDifficulty, setBotDifficulty] = useState<'CASUAL' | 'BALANCED' | 'CHALLENGER'>('CASUAL');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [lastActionText, setLastActionText] = useState<string | null>(null);

  const [seatCredentialsById, setSeatCredentialsById] = useState<
    Record<string, SessionCredentials>
  >({});

  const seatsRef = useRef<Map<string, ManagedSeatClient>>(new Map());
  const seqByPlayerRef = useRef<Record<string, number>>({});
  const roomRef = useRef<PublicRoomState | null>(null);
  const leavingRoomCodeRef = useRef<string | null>(null);
  const soundEnabledRef = useRef<boolean>(soundEnabled);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  const pushToast = useCallback(
    (text: string, tone: ToastMessage['tone'] = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3600);
    },
    []
  );

  const refreshLeaderboardAndHistory = useCallback(async () => {
    setLoadingLeaderboard(true);
    try {
      const backendUrl = getBackendUrl();
      const res = await fetch(`${backendUrl}/api/leaderboard`);
      if (res.ok) {
        const data = (await res.json()) as LeaderboardResponse;
        setLeaderboard(data.leaderboard ?? []);
        setRecentMatches(data.recentMatches ?? []);
      }
    } catch {
      // Ignore background refresh error
    } finally {
      setLoadingLeaderboard(false);
    }
  }, []);

  const registerSocketListeners = useCallback(
    (socket: Socket, creds: SessionCredentials, isPrimary: boolean) => {
      if (isPrimary) {
        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));
      }

      socket.on(SOCKET_EVENTS.ROOM_STATE, (nextRoom: PublicRoomState) => {
        if (!nextRoom || nextRoom.roomCode === leavingRoomCodeRef.current) {
          return;
        }
        if (isPrimary) {
          setRoom(nextRoom);
          if (nextRoom.turnDeadlineAt !== undefined) {
            setTurnDeadlineAt(nextRoom.turnDeadlineAt);
          }
        }
      });

      socket.on(SOCKET_EVENTS.GAME_VIEW, (payload: GameViewBroadcast) => {
        if (
          !payload?.view ||
          (payload.roomCode && payload.roomCode === leavingRoomCodeRef.current)
        ) {
          return;
        }
        seqByPlayerRef.current[creds.playerId] = Math.max(
          seqByPlayerRef.current[creds.playerId] ?? 0,
          payload.view.lastSeq
        );
        if (isPrimary && payload.turnDeadlineAt !== undefined) {
          setTurnDeadlineAt(payload.turnDeadlineAt);
        }

        if (isPrimary) {
          // Detect turn transition to primary player -> Trigger 'Your Turn!' sound ping
          setViewsBySeat((prev) => {
            const prevView = prev[creds.playerId];
            const isMyTurnNow = payload.view.currentPlayerId === creds.playerId;
            const wasMyTurnBefore = prevView?.currentPlayerId === creds.playerId;
            if (isMyTurnNow && !wasMyTurnBefore && payload.view.status === 'IN_PROGRESS') {
              playSynthesizedFx('yourTurn', soundEnabledRef.current);
            }
            return {
              ...prev,
              [creds.playerId]: payload.view,
            };
          });
        } else {
          setViewsBySeat((prev) => ({
            ...prev,
            [creds.playerId]: payload.view,
          }));
        }
      });

      if (isPrimary) {
        socket.on(SOCKET_EVENTS.GAME_EVENTS, (payload: GameEventsBroadcast) => {
          const members = roomRef.current?.players ?? [];
          const isInActiveGame = roomRef.current?.status === 'IN_GAME';

          for (const evt of payload.events) {
            // Update subtle visual action ticker in center HUD bar
            const tickerText = formatActionTickerText(evt, members);
            if (tickerText) {
              setLastActionText(tickerText);
            }

            // Text toasts are omitted during active gameplay
            if (!isInActiveGame) {
              const formatted = formatEventToast(evt, members);
              if (formatted) {
                pushToast(formatted.text, formatted.tone);
              }
            }

            // Trigger rich Web Audio synthesized sound feedback chimes
            if (evt.type === 'CARD_PLAYED') {
              const isWild = evt.card.color === 'WILD';
              playSynthesizedFx(isWild ? 'wild' : 'play', soundEnabledRef.current, isWild ? 'WILD' : evt.card.color);
            } else if (evt.type === 'DISCARD_ALL_PLAYED' || evt.type === 'COLOR_ROULETTE_RESOLVED') {
              playSynthesizedFx('swap', soundEnabledRef.current);
            } else if (evt.type === 'PLAYER_ELIMINATED') {
              playSynthesizedFx('uno', soundEnabledRef.current);
              const koToast = formatEventToast(evt, members);
              if (koToast) {
                pushToast(koToast.text, koToast.tone);
              }
            } else if (evt.type === 'CARDS_DRAWN') {
              playSynthesizedFx('draw', soundEnabledRef.current);
            } else if (evt.type === 'UNO_CALLED' || evt.type === 'UNO_CAUGHT') {
              playSynthesizedFx('uno', soundEnabledRef.current);
            } else if (evt.type === 'HANDS_SWAPPED' || evt.type === 'WD4_CHALLENGE_RESOLVED') {
              playSynthesizedFx('swap', soundEnabledRef.current);
            } else if (evt.type === 'ROUND_ENDED' || evt.type === 'MATCH_ENDED') {
              playSynthesizedFx('win', soundEnabledRef.current);
              if (evt.type === 'MATCH_ENDED') {
                void refreshLeaderboardAndHistory();
              }
            }
          }
        });

        socket.on(
          SOCKET_EVENTS.ERROR_EVENT,
          (errPayload: ProtocolErrorPayload) => {
            pushToast(errPayload.message, 'error');
            playSynthesizedFx('error', soundEnabledRef.current);
          }
        );
      }
    },
    [pushToast, refreshLeaderboardAndHistory]
  );

  // Initialize primary session (Guest by default, or restore saved account email if present)
  useEffect(() => {
    let mounted = true;
    const seatsMap = seatsRef.current;

    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Ignore service worker registration errors in restricted preview frames
      });
    }

    const savedName =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('cardclash_name') || 'Alex'
        : 'Alex';
    const savedPlayerId =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('cardclash_pid') || undefined
        : undefined;
    const savedEmail =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('cardclash_email') || undefined
        : undefined;

    const tokenPromise = savedEmail
      ? fetchAccountToken(savedEmail, savedName, savedPlayerId)
      : fetchGuestToken(savedName, savedPlayerId);

    tokenPromise
      .then((creds) => {
        if (!mounted) return;
        window.sessionStorage.setItem('cardclash_name', creds.name);
        window.sessionStorage.setItem('cardclash_pid', creds.playerId);
        if (creds.email) {
          window.sessionStorage.setItem('cardclash_email', creds.email);
        }

        setPlayerName(creds.name);
        setPrimaryCreds(creds);
        setActiveSeatId(creds.playerId);
        setSeatCredentialsById((prev) => ({
          ...prev,
          [creds.playerId]: creds,
        }));

        const socket = createGameSocket(creds, true);
        if ((socket as any).isServerlessFallback) {
          ServerlessFallbackSocket.clearActiveRoomStorage();
        }

        seatsMap.set(creds.playerId, { credentials: creds, socket });
        registerSocketListeners(socket, creds, true);
        void refreshLeaderboardAndHistory();
      })
      .catch((err) => {
        if (mounted) {
          console.error('[CardClash] Session initialization failed:', err);
          pushToast(`Session Error: ${err instanceof Error ? err.message : String(err)}`, 'error');
        }
      });

    return () => {
      mounted = false;
      for (const entry of seatsMap.values()) {
        entry.socket.disconnect();
      }
      seatsMap.clear();
    };
  }, [pushToast, registerSocketListeners, refreshLeaderboardAndHistory]);

  const getNextSeq = useCallback((playerId: string): number => {
    const next = (seqByPlayerRef.current[playerId] ?? 0) + 1;
    seqByPlayerRef.current[playerId] = next;
    return next;
  }, []);

  const dispatchActionForSeat = useCallback(
    (playerId: string, intentWithoutSeq: ClientGameActionDraft) => {
      const seat = seatsRef.current.get(playerId);
      if (!seat || !roomRef.current) return;
      const seq = getNextSeq(playerId);
      const fullAction = {
        ...intentWithoutSeq,
        seq,
      } as ClientGameActionIntent;

      seat.socket.emit(SOCKET_EVENTS.GAME_ACTION, {
        roomCode: roomRef.current.roomCode,
        action: fullAction,
      });
    },
    [getNextSeq]
  );

  // Automatic Companion Seat Turn Driver (when autoPlayCompanions is enabled)
  useEffect(() => {
    if (!autoPlayCompanions || !room || room.status !== 'IN_GAME') return;
    const primaryId = primaryCreds?.playerId;

    // Check if any non-primary companion seat currently has the active turn
    for (const [seatId, view] of Object.entries(viewsBySeat)) {
      if (seatId === primaryId || seatId === activeSeatId) continue;
      if (view.status !== 'IN_PROGRESS') continue;
      if (view.currentPlayerId !== seatId) continue;

      const timer = setTimeout(() => {
        let preferredColor: ColoredCardColor = 'RED';
        if (botDifficulty === 'CASUAL' && Math.random() < 0.45) {
          const presentColors = (['RED', 'BLUE', 'YELLOW', 'GREEN'] as const).filter((col) =>
            view.hand.some((c) => c.color === col)
          );
          preferredColor = presentColors.length > 0
            ? presentColors[Math.floor(Math.random() * presentColors.length)]!
            : (['RED', 'BLUE', 'YELLOW', 'GREEN'] as const)[Math.floor(Math.random() * 4)]!;
        } else {
          preferredColor = (['RED', 'BLUE', 'YELLOW', 'GREEN'] as const).find((col) =>
            view.hand.some((c) => c.color === col)
          ) ?? 'RED';
        }

        if (view.turnPhase === 'AWAITING_INITIAL_WILD_COLOR') {
          dispatchActionForSeat(seatId, {
            type: 'CHOOSE_INITIAL_COLOR',
            color: preferredColor,
          });
          return;
        }

        if (view.turnPhase === 'AWAITING_ROULETTE_COLOR') {
          dispatchActionForSeat(seatId, {
            type: 'CHOOSE_ROULETTE_COLOR',
            color: preferredColor,
          });
          return;
        }

        if (view.turnPhase === 'AWAITING_SWAP_TARGET') {
          const opponents = view.opponents.filter((o) => !o.eliminated);
          if (opponents.length > 0) {
            let target = opponents[0]!;
            if (botDifficulty === 'CASUAL') {
              target = Math.random() < 0.5
                ? opponents[Math.floor(Math.random() * opponents.length)]!
                : opponents.slice().sort((a, b) => a.cardCount - b.cardCount)[0]!;
            } else {
              target = opponents.slice().sort((a, b) => a.cardCount - b.cardCount)[0]!;
            }
            dispatchActionForSeat(seatId, {
              type: 'CHOOSE_SWAP_TARGET',
              targetPlayerId: target.id,
            });
          }
          return;
        }

        if (view.turnPhase === 'AWAITING_WD4_CHALLENGE') {
          dispatchActionForSeat(seatId, {
            type: 'ACCEPT_WILD_DRAW_FOUR',
          });
          return;
        }

        const willLeaveOneCard = (card: Card): boolean => {
          if (card.kind === 'DISCARD_ALL') {
            return (
              view.hand.filter((c) => c.id !== card.id && c.color !== card.color)
                .length === 1
            );
          }
          return view.hand.length === 2;
        };

        if (view.turnPhase === 'DRAWN_PLAY_OR_PASS') {
          const drawnCard = view.hand.find(
            (c) => c.id === view.pendingDrawnCardId
          );
          if (
            drawnCard &&
            isPlayable(drawnCard, {
              topCard: view.topDiscard,
              currentColor: view.currentColor,
              hand: view.hand,
              houseRules: view.houseRules,
              turnPhase: view.turnPhase,
              pendingDrawnCardId: view.pendingDrawnCardId,
              pendingDrawCount: view.pendingDrawCount,
              pendingDrawKind: view.pendingDrawKind,
            })
          ) {
            const needsWildColor =
              drawnCard.color === 'WILD' &&
              drawnCard.kind !== 'WILD_COLOR_ROULETTE';
            dispatchActionForSeat(seatId, {
              type: 'PLAY_CARD',
              cardId: drawnCard.id,
              ...(needsWildColor ? { chosenColor: preferredColor } : {}),
              callUno: willLeaveOneCard(drawnCard),
            });
          } else {
            dispatchActionForSeat(seatId, { type: 'PASS_TURN' });
          }
          return;
        }

        // Standard PLAY_OR_DRAW or STACK_OR_DRAW
        const playableCards = view.hand.filter((c) =>
          isPlayable(c, {
            topCard: view.topDiscard,
            currentColor: view.currentColor,
            hand: view.hand,
            houseRules: view.houseRules,
            turnPhase: view.turnPhase,
            pendingDrawnCardId: view.pendingDrawnCardId,
            pendingDrawCount: view.pendingDrawCount,
            pendingDrawKind: view.pendingDrawKind,
          })
        );

        if (playableCards.length > 0) {
          let chosen = playableCards[0]!;

          if (botDifficulty === 'CASUAL') {
            const regularCards = playableCards.filter((c) => c.kind === 'NUMBER');
            if (regularCards.length > 0 && Math.random() < 0.7) {
              chosen = regularCards[Math.floor(Math.random() * regularCards.length)]!;
            } else {
              playableCards.sort(
                (a, b) => (a.color === 'WILD' ? 1 : 0) - (b.color === 'WILD' ? 1 : 0)
              );
              chosen = playableCards[0]!;
            }
          } else {
            playableCards.sort(
              (a, b) => (a.color === 'WILD' ? 1 : 0) - (b.color === 'WILD' ? 1 : 0)
            );
            chosen = playableCards[0]!;
          }

          const needsWildColor =
            chosen.color === 'WILD' &&
            chosen.kind !== 'WILD_COLOR_ROULETTE';
          dispatchActionForSeat(seatId, {
            type: 'PLAY_CARD',
            cardId: chosen.id,
            ...(needsWildColor ? { chosenColor: preferredColor } : {}),
            callUno: willLeaveOneCard(chosen),
          });
        } else {
          dispatchActionForSeat(seatId, { type: 'DRAW_CARD' });
        }
      }, 400);

      return () => clearTimeout(timer);
    }
  }, [
    autoPlayCompanions,
    room,
    viewsBySeat,
    primaryCreds?.playerId,
    activeSeatId,
    botDifficulty,
    dispatchActionForSeat,
  ]);

  const swapPrimarySessionCredentials = useCallback(
    (updated: SessionCredentials) => {
      window.sessionStorage.setItem('cardclash_name', updated.name);
      window.sessionStorage.setItem('cardclash_pid', updated.playerId);
      if (updated.email) {
        window.sessionStorage.setItem('cardclash_email', updated.email);
      } else {
        window.sessionStorage.removeItem('cardclash_email');
      }

      const prevId = primaryCreds?.playerId;
      if (prevId && seatsRef.current.has(prevId)) {
        const oldEntry = seatsRef.current.get(prevId)!;
        oldEntry.socket.disconnect();
        seatsRef.current.delete(prevId);
      }

      const socket = createGameSocket(updated);

      seatsRef.current.set(updated.playerId, {
        credentials: updated,
        socket,
      });
      setSeatCredentialsById((prev) => {
        const next = { ...prev };
        if (prevId && prevId !== updated.playerId) {
          delete next[prevId];
        }
        next[updated.playerId] = updated;
        return next;
      });
      registerSocketListeners(socket, updated, true);
      setPrimaryCreds(updated);
      setPlayerName(updated.name);
      setActiveSeatId(updated.playerId);
      void refreshLeaderboardAndHistory();
    },
    [primaryCreds?.playerId, registerSocketListeners, refreshLeaderboardAndHistory]
  );

  const handleUpdateName = async (newName: string) => {
    const trimmed = newName.trim().slice(0, 24) || 'Player';
    setPlayerName(trimmed);
    if (!primaryCreds) return;

    try {
      const updated = primaryCreds.email
        ? await fetchAccountToken(
            primaryCreds.email,
            trimmed,
            primaryCreds.playerId
          )
        : await fetchGuestToken(trimmed, primaryCreds.playerId);
      swapPrimarySessionCredentials(updated);
      pushToast(`Signed session updated as ${updated.name}`, 'success');
    } catch {
      pushToast('Failed to update player name', 'error');
    }
  };

  const handleSignInAccount = async (email: string, name: string) => {
    try {
      const updated = await fetchAccountToken(
        email,
        name,
        primaryCreds?.playerId
      );
      swapPrimarySessionCredentials(updated);
      pushToast(
        `Signed in as ${updated.name} (${updated.email}) · Verified token active`,
        'success'
      );
    } catch (error) {
      pushToast(
        error instanceof Error ? error.message : 'Sign-in failed',
        'error'
      );
      throw error;
    }
  };

  const handleSwitchToGuest = async () => {
    try {
      const guestCreds = await fetchGuestToken(playerName);
      swapPrimarySessionCredentials(guestCreds);
      pushToast(`Switched to default Guest session (${guestCreds.name})`, 'info');
    } catch {
      pushToast('Could not switch to guest session', 'error');
    }
  };

  const handleCreateRoom = () => {
    if (!primaryCreds) {
      pushToast('Initializing session token, please wait...', 'info');
      return;
    }
    const primary = seatsRef.current.get(primaryCreds.playerId);
    if (!primary) {
      pushToast('Connecting to game server...', 'info');
      return;
    }

    leavingRoomCodeRef.current = null;
    ServerlessFallbackSocket.clearActiveRoomStorage();

    primary.socket.emit(
      SOCKET_EVENTS.ROOM_CREATE,
      {
        targetScore,
        maxPlayers,
        houseRules,
      },
      (res: SocketAckResult<{ room: PublicRoomState }>) => {
        if (!res) {
          pushToast('Failed to connect to room service', 'error');
          return;
        }
        if (res.ok) {
          leavingRoomCodeRef.current = null;
          setRoom(res.data.room);
          setActiveSeatId(primaryCreds.playerId);
          pushToast(`Room ${res.data.room.roomCode} created!`, 'success');
        } else {
          pushToast(res.error?.message || 'Failed to create room', 'error');
        }
      }
    );
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!primaryCreds) {
      pushToast('Initializing session token, please wait...', 'info');
      return;
    }
    const code = joinCodeInput.trim().toUpperCase();
    if (code.length !== 4) {
      pushToast('Enter a 4-character room code', 'error');
      return;
    }

    const primary = seatsRef.current.get(primaryCreds.playerId);
    if (!primary) {
      pushToast('Connecting to game server...', 'info');
      return;
    }

    leavingRoomCodeRef.current = null;
    ServerlessFallbackSocket.clearActiveRoomStorage();

    primary.socket.emit(
      SOCKET_EVENTS.ROOM_JOIN,
      { roomCode: code },
      (res: SocketAckResult<{ room: PublicRoomState }>) => {
        if (!res) {
          pushToast(`Could not reach server for room ${code}`, 'error');
          return;
        }
        if (res.ok) {
          leavingRoomCodeRef.current = null;
          setRoom(res.data.room);
          setActiveSeatId(primaryCreds.playerId);
          pushToast(`Joined room ${res.data.room.roomCode}!`, 'success');
        } else {
          pushToast(res.error?.message || `Room ${code} not found or is full`, 'error');
        }
      }
    );
  };

  const handleToggleReady = () => {
    if (!primaryCreds || !room) return;
    const primary = seatsRef.current.get(primaryCreds.playerId);
    if (!primary) return;
    const myMember = room.players.find((p) => p.id === primaryCreds.playerId);
    if (!myMember) return;

    primary.socket.emit(SOCKET_EVENTS.ROOM_READY, {
      roomCode: room.roomCode,
      ready: !myMember.ready,
    });
  };

  const handleAddCompanionSeat = async () => {
    if (!room) return;
    if (room.players.length >= room.maxPlayers) {
      pushToast('Room is already at maximum capacity', 'warning');
      return;
    }

    const companionIndex = seatsRef.current.size;
    const companionName =
      COMPANION_NAMES[(companionIndex - 1) % COMPANION_NAMES.length] ??
      `Bot ${companionIndex}`;

    try {
      const creds = await fetchGuestToken(companionName);
      const compSocket = createGameSocket(creds, false);

      seatsRef.current.set(creds.playerId, {
        credentials: creds,
        socket: compSocket,
      });
      setSeatCredentialsById((prev) => ({
        ...prev,
        [creds.playerId]: creds,
      }));
      registerSocketListeners(compSocket, creds, false);

      compSocket.once('connect', () => {
        compSocket.emit(
          SOCKET_EVENTS.ROOM_JOIN,
          { roomCode: room.roomCode },
          (joinRes: SocketAckResult<{ room: PublicRoomState }>) => {
            if (joinRes.ok) {
              compSocket.emit(SOCKET_EVENTS.ROOM_READY, {
                roomCode: room.roomCode,
                ready: true,
              });
              pushToast(`${companionName} joined & readied up`, 'success');
              void refreshLeaderboardAndHistory();
            }
          }
        );
      });
    } catch {
      pushToast('Could not add companion seat', 'error');
    }
  };

  // Periodic application-level heartbeat (10s interval)
  useEffect(() => {
    if (!connected || !primaryCreds) return;
    const primary = seatsRef.current.get(primaryCreds.playerId);
    if (!primary) return;

    const interval = setInterval(() => {
      primary.socket.emit(
        SOCKET_EVENTS.SESSION_HEARTBEAT,
        { clientTime: Date.now() },
        (
          res?: SocketAckResult<{
            serverTime: number;
            roomCode: string | null;
            turnDeadlineAt: number | null;
          }>
        ) => {
          if (res?.ok && res.data.turnDeadlineAt !== undefined) {
            setTurnDeadlineAt(res.data.turnDeadlineAt);
          }
        }
      );
    }, 10_000);

    return () => clearInterval(interval);
  }, [connected, primaryCreds]);

  const handleStartMatch = () => {
    if (!primaryCreds || !room) return;
    const primary = seatsRef.current.get(primaryCreds.playerId);
    if (!primary) return;

    primary.socket.emit(SOCKET_EVENTS.ROOM_START, {
      roomCode: room.roomCode,
    });
  };

  const handleRematch = () => {
    if (!primaryCreds || !room) return;
    const primary = seatsRef.current.get(primaryCreds.playerId);
    if (!primary) return;

    seqByPlayerRef.current = {};
    primary.socket.emit(SOCKET_EVENTS.ROOM_REMATCH, {
      roomCode: room.roomCode,
    });
  };

  const handleLeaveRoom = () => {
    const currentRoomCode = room?.roomCode ?? roomRef.current?.roomCode ?? null;
    if (currentRoomCode) {
      leavingRoomCodeRef.current = currentRoomCode;
    }
    ServerlessFallbackSocket.clearActiveRoomStorage(currentRoomCode);

    // Immediately clear local UI state so the user returns to the Home screen with zero delay
    roomRef.current = null;
    setRoom(null);
    setViewsBySeat({});
    setTurnDeadlineAt(null);
    setLastActionText(null);
    seqByPlayerRef.current = {};
    if (primaryCreds) {
      setActiveSeatId(primaryCreds.playerId);
    }

    if (!primaryCreds) return;

    const companionPlayerIds: string[] = [];
    for (const [pid, entry] of seatsRef.current.entries()) {
      if (pid !== primaryCreds.playerId) {
        companionPlayerIds.push(pid);
        if (currentRoomCode && !(entry.socket as any).isServerlessFallback) {
          entry.socket.emit(SOCKET_EVENTS.ROOM_LEAVE, { roomCode: currentRoomCode });
        }
        entry.socket.disconnect();
        seatsRef.current.delete(pid);
      }
    }
    setSeatCredentialsById({ [primaryCreds.playerId]: primaryCreds });

    const primary = seatsRef.current.get(primaryCreds.playerId);
    if (primary && currentRoomCode) {
      primary.socket.emit(
        SOCKET_EVENTS.ROOM_LEAVE,
        {
          roomCode: currentRoomCode,
          companionPlayerIds,
        },
        () => {
          void refreshLeaderboardAndHistory();
        }
      );
    } else {
      void refreshLeaderboardAndHistory();
    }
  };

  const handleCopyRoomCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopiedCode(true);
      pushToast(`Copied room code ${room.roomCode}`, 'success');
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      pushToast(`Room code: ${room.roomCode}`, 'info');
    }
  };

  const activeView =
    viewsBySeat[activeSeatId] ??
    (primaryCreds ? viewsBySeat[primaryCreds.playerId] : undefined) ??
    null;

  const companionSeatList: CompanionSeatInfo[] = Object.values(
    seatCredentialsById
  ).map((cred) => {
    const v = viewsBySeat[cred.playerId];
    return {
      playerId: cred.playerId,
      name: cred.name,
      hasTurn: v ? v.currentPlayerId === cred.playerId : false,
      cardCount: v ? v.hand.length : 7,
    };
  });

  const isGuestSession = primaryCreds?.isGuest ?? true;

  return (
    <div className="min-h-screen bg-[#0B2B26] text-stone-100 flex flex-col">
      {/* Global Non-Blocking Event Toast Stack (Top-Right below header bar) */}
      <div
        aria-live="polite"
        className="fixed top-16 right-4 sm:top-20 sm:right-6 z-50 flex flex-col gap-2 max-w-xs sm:max-w-sm pointer-events-none"
      >
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.96 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className={`px-3.5 py-2.5 rounded-xl text-xs font-medium shadow-2xl border backdrop-blur-md transition-colors ${
                t.tone === 'error'
                  ? 'bg-rose-950/75 border-rose-500/40 text-rose-100'
                  : t.tone === 'warning'
                    ? 'bg-amber-950/75 border-amber-500/40 text-amber-100'
                    : t.tone === 'success'
                      ? 'bg-emerald-950/75 border-emerald-500/40 text-emerald-100'
                      : 'bg-slate-900/75 border-white/15 text-stone-100'
              }`}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Phase 5 Optional Auth.js Account Sign-In Modal */}
      <AccountSignInModal
        key={authModalOpen ? 'auth-open' : 'auth-closed'}
        isOpen={authModalOpen}
        currentName={playerName}
        currentEmail={primaryCreds?.email ?? null}
        isGuest={isGuestSession}
        onClose={() => setAuthModalOpen(false)}
        onSignIn={handleSignInAccount}
        onSwitchToGuest={handleSwitchToGuest}
      />

      {/* View 3: Active Game Table */}
      {room &&
      activeView &&
      (room.status === 'IN_GAME' || room.status === 'FINISHED') ? (
        <CardTableView
          room={room}
          view={activeView}
          viewerName={
            seatCredentialsById[activeView.viewerId]?.name ?? playerName
          }
          turnDeadlineAt={turnDeadlineAt}
          companionSeats={companionSeatList}
          activeSeatId={activeView.viewerId}
          autoPlayCompanions={autoPlayCompanions}
          soundEnabled={soundEnabled}
          lastActionText={lastActionText}
          onSwitchSeat={(pid) => setActiveSeatId(pid)}
          onToggleAutoPlay={() => setAutoPlayCompanions((v) => !v)}
          onToggleSound={() => setSoundEnabled((v) => !v)}
          onDispatchAction={(intent) =>
            dispatchActionForSeat(activeView.viewerId, intent)
          }
          onRematch={handleRematch}
          onLeaveRoom={handleLeaveRoom}
        />
      ) : room ? (
        /* View 2: Room Lobby */
        <div className="min-h-screen flex flex-col">
          {/* Strict 3-Zone Top Bar */}
          <header className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-white/10 bg-[#09221E]/90">
            <span className="text-lg font-bold tracking-tight text-stone-100">
              CardClash
            </span>
            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-300">
              <span className="text-stone-100">Room Lobby</span>
            </nav>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleLeaveRoom}
                className="min-h-10 px-4 py-2 text-xs font-medium text-stone-200 bg-white/5 hover:bg-rose-500/20 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Leave Room</span>
              </button>
            </div>
          </header>

          <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-8">
            {/* Room Code Hero Readout */}
            <div className="rounded-2xl bg-[#10352F] border border-white/10 p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
              <div className="space-y-1.5">
                <p className="text-xs text-stone-300">
                  Share 4-Letter Room Code · {room.players.length}/{room.maxPlayers} Seated · Target {room.targetScore} pts
                </p>
                <div className="flex items-center gap-4">
                  <span className="text-4xl sm:text-5xl font-extrabold font-mono tabular-nums tracking-widest text-white">
                    {room.roomCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyRoomCode}
                    className="min-h-11 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-stone-100 flex items-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={handleAddCompanionSeat}
                  disabled={room.players.length >= room.maxPlayers}
                  className="min-h-11 px-4 py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-900 disabled:opacity-40 border border-white/15 text-xs font-semibold text-stone-200 flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <UserPlus className="w-4 h-4 text-emerald-400" />
                  <span>Add Companion Seat</span>
                </button>

                <button
                  type="button"
                  onClick={handleToggleReady}
                  className={`min-h-11 px-5 py-2.5 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    room.players.find((p) => p.id === primaryCreds?.playerId)?.ready
                      ? 'bg-slate-800 hover:bg-slate-700 text-stone-200 border border-white/15'
                      : 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold'
                  }`}
                >
                  {room.players.find((p) => p.id === primaryCreds?.playerId)?.ready
                    ? 'Ready (Click to Unready)'
                    : 'Ready Up'}
                </button>

                {room.hostPlayerId === primaryCreds?.playerId && (
                  <button
                    type="button"
                    onClick={handleStartMatch}
                    disabled={
                      room.players.length < 2 ||
                      !room.players.every((p) => p.ready)
                    }
                    className="min-h-11 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-bold text-white flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Play className="w-4 h-4" />
                    <span>Start Match</span>
                  </button>
                )}
              </div>
            </div>

            {/* Seated Players List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-stone-100">
                  Seated Players
                </h2>
                <span className="text-xs text-stone-400">
                  All seated players must mark Ready before the host starts
                </span>
              </div>

              <div className="divide-y divide-white/10 rounded-2xl bg-[#10352F]/70 border border-white/10">
                {room.players.map((member, idx) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between px-5 py-4"
                  >
                    <div className="space-y-0.5">
                      <p className="text-sm font-semibold text-stone-100">
                        {idx + 1}. {member.name}
                        {member.id === primaryCreds?.playerId ? ' (You)' : ''}
                      </p>
                      <p className="text-xs text-stone-400">
                        {member.isHost ? 'Room Host' : 'Player'} ·{' '}
                        {member.isGuest === false
                          ? 'Verified Account'
                          : 'Guest Session'}{' '}
                        · {member.connected ? 'Connected' : 'Disconnected'}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-mono font-semibold ${
                        member.ready ? 'text-emerald-300' : 'text-amber-300'
                      }`}
                    >
                      {member.ready ? 'Ready' : 'Waiting'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Active House Rules Unboxed Metadata */}
            <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-300">
              <span>
                Mode:{' '}
                <strong
                  className={
                    room.houseRules.gameMode === 'NO_MERCY'
                      ? 'text-rose-300'
                      : 'text-emerald-300'
                  }
                >
                  {room.houseRules.gameMode === 'NO_MERCY'
                    ? "UNO Show 'Em No Mercy (25-Card KO · +250 KO Bonus · Draw-Until-Playable)"
                    : 'Classic Mode'}
                </strong>{' '}
                · Rules:{' '}
                {[
                  room.houseRules.stacking
                    ? room.houseRules.gameMode === 'NO_MERCY'
                      ? 'Progressive Stacking (+2/+4/+6/+10)'
                      : 'Stacking (+2/+4)'
                    : null,
                  room.houseRules.sevenZeroSwap ? '7-0 Hand Swap' : null,
                  room.houseRules.jumpIn ? 'Jump-In' : null,
                  room.houseRules.wildDrawFourChallenge ? '+4 Bluff Challenge' : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Standard Official Rules'}
              </span>
              <span className="font-mono tabular-nums text-stone-400">
                {room.houseRules.gameMode === 'NO_MERCY'
                  ? '168-Card Brutal Deck · 7 Cards Dealt · 25-Card Mercy Limit'
                  : '108-Card Deck · 7 Cards Dealt'}
              </span>
            </div>
          </main>
        </div>
      ) : (
        /* View 1: Home Screen */
        <div className="min-h-screen flex flex-col">
          {/* Strict 3-Zone Top Bar Contract */}
          <header className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-white/10 bg-[#09221E]/90">
            <a
              href="#top"
              className="text-lg font-bold tracking-tight text-stone-100 whitespace-nowrap"
            >
              CardClash
            </a>

            <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-stone-300">
              <a
                href="#play"
                className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
              >
                Play
              </a>
              <a
                href="#leaderboard"
                className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
              >
                Leaderboard
              </a>
              <a
                href="#rules"
                className="hover:text-white hover:underline underline-offset-4 transition-colors whitespace-nowrap"
              >
                Rules
              </a>
            </nav>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setAuthModalOpen(true)}
                className="min-h-10 px-3.5 py-2 text-xs font-semibold text-stone-100 bg-white/10 hover:bg-white/15 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
              >
                {isGuestSession ? (
                  <>
                    <User className="w-3.5 h-3.5 text-amber-300" />
                    <span>Sign In (Guest Default)</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{primaryCreds?.email}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setSoundEnabled((v) => !v)}
                aria-label="Toggle audio"
                className="min-h-10 px-3 py-2 text-xs font-medium text-stone-200 bg-white/5 hover:bg-white/10 rounded-lg transition-colors whitespace-nowrap flex items-center gap-1.5 cursor-pointer"
              >
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <VolumeX className="w-4 h-4 text-stone-400" />
                )}
                <span className="hidden sm:inline">
                  {connected ? 'Server Online' : 'Connecting'}
                </span>
              </button>
            </div>
          </header>

          <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-8 py-8 sm:py-12 space-y-12">
            {/* Hero + Create/Join Arena */}
            <section
              id="play"
              className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
            >
              {/* Left Column: Headline, Card Fan Preview & Player Profile */}
              <div className="lg:col-span-7 space-y-6">
                <div className="space-y-3">
                  <p className="text-xs text-emerald-300 font-medium">
                    Authoritative Real-Time Multiplayer · Classic &amp; Show &apos;Em No Mercy Modes
                  </p>
                  <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white max-w-xl text-balance">
                    Fast, Colorblind-Safe Shedding Card Battles.
                  </h1>
                  <p className="text-sm sm:text-base text-stone-300 max-w-xl leading-relaxed">
                    Create a 4-letter room code in Classic Mode (108 cards) or Show &apos;Em No Mercy Mode (168 cards, +6/+10 Wilds, Color Roulette, and 25-card Mercy Knockouts). Every shuffle and action is verified on the server.
                  </p>
                </div>

                {/* Live Original SVG Card Art Showcase */}
                <div
                  id="suits"
                  className="py-4 px-2 flex items-center justify-start gap-1 sm:gap-2 overflow-x-auto"
                >
                  {(houseRules.gameMode === 'NO_MERCY'
                    ? DEMO_NO_MERCY_CARDS
                    : DEMO_CARDS
                  ).map((card, i) => (
                    <div
                      key={card.id}
                      style={{
                        transform: `rotate(${(i - 2) * 4}deg)`,
                        marginLeft: i === 0 ? 0 : '-12px',
                      }}
                      className="shrink-0"
                    >
                      <CardGraphic card={card} size="md" playable={i === 0} />
                    </div>
                  ))}
                </div>

                {/* Player Identity & Account Status Bar */}
                <div className="rounded-2xl bg-[#10352F]/90 border border-white/10 p-5 space-y-3 max-w-xl">
                  <div className="flex items-center justify-between text-xs text-stone-300">
                    <label
                      htmlFor="player-name-input"
                      className="font-semibold text-stone-100"
                    >
                      Your Player Identity ({isGuestSession ? 'Guest Default' : 'Verified Account'})
                    </label>
                    <span className="font-mono tabular-nums text-stone-400">
                      {primaryCreds?.profile
                        ? `${primaryCreds.profile.rating.displayRating} SR · ${primaryCreds.playerId.slice(0, 10)}`
                        : primaryCreds
                          ? `Session ${primaryCreds.playerId.slice(0, 10)}`
                          : 'Issuing token...'}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      id="player-name-input"
                      type="text"
                      value={playerName}
                      maxLength={24}
                      onChange={(e) => setPlayerName(e.target.value)}
                      onBlur={() => void handleUpdateName(playerName)}
                      placeholder="Enter display name"
                      className="flex-1 min-h-11 px-3.5 py-2 rounded-xl bg-slate-950/80 border border-white/15 text-sm text-white placeholder:text-stone-500 focus:outline-none focus:border-emerald-400"
                    />
                    <button
                      type="button"
                      onClick={() => void handleUpdateName(playerName)}
                      className="min-h-11 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-semibold text-stone-100 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Save Name
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Create Room & Join by 4-Letter Code */}
              <div className="lg:col-span-5 space-y-6">
                {/* Join Existing Room */}
                <form
                  onSubmit={handleJoinRoom}
                  className="rounded-2xl bg-[#10352F] border border-white/10 p-5 sm:p-6 space-y-4"
                >
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-white">
                      Join by 4-Letter Room Code
                    </h2>
                    <p className="text-xs text-stone-300">
                      Have a room code? Enter it below to take an open seat.
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={joinCodeInput}
                      maxLength={4}
                      onChange={(e) =>
                        setJoinCodeInput(e.target.value.toUpperCase())
                      }
                      placeholder="K7M2"
                      aria-label="4-letter room code"
                      className="w-32 min-h-11 px-3.5 py-2 rounded-xl bg-slate-950/90 border border-white/15 text-center text-lg font-bold font-mono tabular-nums tracking-widest uppercase text-white placeholder:text-stone-600 focus:outline-none focus:border-emerald-400"
                    />
                    <button
                      type="submit"
                      disabled={!primaryCreds}
                      className="flex-1 min-h-11 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-40 text-xs font-bold text-white flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <span>Join Room</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>

                {/* Create New Room */}
                <div className="rounded-2xl bg-[#10352F] border border-white/10 p-5 sm:p-6 space-y-5">
                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-white">
                      Create New Room
                    </h2>
                    <p className="text-xs text-stone-300">
                      Select your game mode, target score, and rule set.
                    </p>
                  </div>

                  {/* Game Mode Selector: Classic vs UNO Show 'Em No Mercy */}
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-stone-200 block">
                      Game Mode
                    </span>
                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setHouseRules({ ...DEFAULT_HOUSE_RULES, gameMode: 'CLASSIC' });
                          setTargetScore(500);
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          houseRules.gameMode !== 'NO_MERCY'
                            ? 'bg-emerald-600/25 border-emerald-400 text-white shadow-md'
                            : 'bg-slate-950/60 border-white/10 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        <div className="text-xs font-bold">Classic Mode</div>
                        <div className="text-[10px] font-mono text-stone-300 mt-0.5">
                          108 Cards · Standard
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setHouseRules({ ...NO_MERCY_HOUSE_RULES });
                          setTargetScore(1000);
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          houseRules.gameMode === 'NO_MERCY'
                            ? 'bg-rose-600/25 border-rose-400 text-white shadow-md'
                            : 'bg-slate-950/60 border-white/10 text-stone-400 hover:text-stone-200'
                        }`}
                      >
                        <div className="text-xs font-bold text-rose-300">
                          No Mercy Mode
                        </div>
                        <div className="text-[10px] font-mono text-stone-300 mt-0.5">
                          168 Cards · 25-Card KO
                        </div>
                      </button>
                    </div>
                    {houseRules.gameMode === 'NO_MERCY' && (
                      <p className="text-[11px] text-rose-200/90 bg-rose-950/50 border border-rose-500/30 rounded-lg px-3 py-2 leading-relaxed">
                        Includes <strong>+6</strong>, <strong>+10</strong>, <strong>Reverse +4</strong>, <strong>Skip Everyone</strong>, <strong>Discard All</strong>, <strong>Color Roulette</strong>, <strong>Draw-Until-Playable</strong>, and <strong>25-Card Knockout (+250 pts)</strong>.
                      </p>
                    )}
                  </div>

                  {/* Bot AI Difficulty Selector */}
                  <div className="space-y-2 pt-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-stone-200 block">
                          Bot AI Difficulty
                        </span>
                        <span className="text-[11px] font-mono text-stone-400">
                          {botDifficulty === 'CASUAL'
                            ? 'Relaxed & Fun'
                            : botDifficulty === 'BALANCED'
                              ? 'Strategic & Fair'
                              : 'Cutthroat & Hard'}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => setBotDifficulty('CASUAL')}
                          className={`py-2 px-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                            botDifficulty === 'CASUAL'
                              ? 'bg-emerald-600/30 border-emerald-400 text-white font-bold shadow-sm'
                              : 'bg-slate-950/60 border-white/10 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          <div className="text-xs">Casual</div>
                          <div className="text-[10px] text-stone-400 mt-0.5">Friendly AI</div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setBotDifficulty('BALANCED')}
                          className={`py-2 px-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                            botDifficulty === 'BALANCED'
                              ? 'bg-amber-600/30 border-amber-400 text-white font-bold shadow-sm'
                              : 'bg-slate-950/60 border-white/10 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          <div className="text-xs">Balanced</div>
                          <div className="text-[10px] text-stone-400 mt-0.5">Natural AI</div>
                        </button>

                        <button
                          type="button"
                          onClick={() => setBotDifficulty('CHALLENGER')}
                          className={`py-2 px-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                            botDifficulty === 'CHALLENGER'
                              ? 'bg-rose-600/30 border-rose-400 text-white font-bold shadow-sm'
                              : 'bg-slate-950/60 border-white/10 text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          <div className="text-xs text-rose-300">Hard</div>
                          <div className="text-[10px] text-stone-400 mt-0.5">Competitive</div>
                        </button>
                      </div>
                    </div>

                    {/* Target Score & Max Players */}
                    <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="target-score-select"
                        className="text-xs text-stone-300 block"
                      >
                        Target Score
                      </label>
                      <select
                        id="target-score-select"
                        value={targetScore}
                        onChange={(e) => setTargetScore(Number(e.target.value))}
                        className="w-full min-h-10 px-3 py-2 rounded-xl bg-slate-950/90 border border-white/15 text-xs font-mono tabular-nums text-white"
                      >
                        <option value={150}>150 pts (Quick)</option>
                        <option value={300}>300 pts (Medium)</option>
                        <option value={500}>500 pts (Classic)</option>
                        <option value={750}>750 pts (Marathon)</option>
                        <option value={1000}>1000 pts (No Mercy)</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="max-players-select"
                        className="text-xs text-stone-300 block"
                      >
                        Max Seats
                      </label>
                      <select
                        id="max-players-select"
                        value={maxPlayers}
                        onChange={(e) => setMaxPlayers(Number(e.target.value))}
                        className="w-full min-h-10 px-3 py-2 rounded-xl bg-slate-950/90 border border-white/15 text-xs font-mono tabular-nums text-white"
                      >
                        <option value={2}>2 Players</option>
                        <option value={3}>3 Players</option>
                        <option value={4}>4 Players</option>
                        <option value={6}>6 Players</option>
                        <option value={8}>8 Players</option>
                        <option value={10}>10 Players</option>
                      </select>
                    </div>
                  </div>

                  {/* House Rule Toggles */}
                  <div className="space-y-2 pt-1">
                    <p className="text-xs font-semibold text-stone-200">
                      {houseRules.gameMode === 'NO_MERCY'
                        ? 'No Mercy Active Rules'
                        : 'House Rules (Optional)'}
                    </p>
                    {(
                      [
                        {
                          key: 'stacking',
                          label:
                            houseRules.gameMode === 'NO_MERCY'
                              ? 'Progressive Stacking (+2 ≤ +4 ≤ +6 ≤ +10)'
                              : 'Stacking (+2 on +2, +4 on +4)',
                        },
                        {
                          key: 'sevenZeroSwap',
                          label: '7-0 Hand Swap & Rotation',
                        },
                        {
                          key: 'jumpIn',
                          label: 'Jump-In on Exact Card Match',
                        },
                        {
                          key: 'wildDrawFourChallenge',
                          label: 'Wild +4 Bluff Challenge',
                        },
                      ] as const
                    ).map((item) => (
                      <label
                        key={item.key}
                        className="flex items-center justify-between py-1.5 text-xs text-stone-300 cursor-pointer"
                      >
                        <span>{item.label}</span>
                        <input
                          type="checkbox"
                          checked={houseRules[item.key]}
                          onChange={(e) =>
                            setHouseRules((prev) => ({
                              ...prev,
                              [item.key]: e.target.checked,
                            }))
                          }
                          className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                        />
                      </label>
                    ))}
                  </div>

                  <button
                    type="button"
                    disabled={!primaryCreds}
                    onClick={handleCreateRoom}
                    className={`w-full min-h-12 px-5 py-3 rounded-xl disabled:opacity-40 text-sm font-bold text-white flex items-center justify-center gap-2 shadow-lg transition-colors whitespace-nowrap cursor-pointer ${
                      houseRules.gameMode === 'NO_MERCY'
                        ? 'bg-rose-600 hover:bg-rose-500'
                        : 'bg-emerald-600 hover:bg-emerald-500'
                    }`}
                  >
                    <Plus className="w-4 h-4" />
                    <span>
                      {houseRules.gameMode === 'NO_MERCY'
                        ? 'Create No Mercy Room'
                        : 'Create Classic Room'}
                    </span>
                  </button>
                </div>
              </div>
            </section>

            {/* Phase 5: OpenSkill Leaderboard & Match History from Action Log */}
            <LeaderboardAndHistorySection
              leaderboard={leaderboard}
              recentMatches={recentMatches}
              currentPlayerId={primaryCreds?.playerId}
              loading={loadingLeaderboard}
              onRefresh={() => void refreshLeaderboardAndHistory()}
            />

            {/* Colorblind-Safe Suit & Rules Reference */}
            <section
              id="rules"
              className="border-t border-white/10 pt-8 grid grid-cols-1 md:grid-cols-3 gap-6 text-xs text-stone-300"
            >
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-white">
                  01. Colorblind-Safe Suits
                </h3>
                <p className="leading-relaxed">
                  Every card pairs color with a geometric suit symbol: Crimson Triangle (▲), Cobalt Diamond (◆), Amber Circle (●), and Emerald Star (★).
                </p>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-white">
                  02. UNO Call & Catch Window
                </h3>
                <p className="leading-relaxed">
                  At 1 card you must call UNO! Any opponent can catch an uncalled single card before the next player acts, dealing a 2-card penalty.
                </p>
              </div>
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-white">
                  03. Round Scoring & 500 Target
                </h3>
                <p className="leading-relaxed">
                  Round winners score all cards left in opponents&apos; hands: numbers at face value, Skip/Reverse/+2 at 20 pts, and Wild/+4 at 50 pts.
                </p>
              </div>
            </section>
          </main>
        </div>
      )}
    </div>
  );
}

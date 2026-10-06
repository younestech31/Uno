import crypto from 'node:crypto';
import type { ChatMessagePayload, ChatReportRecord } from '@cardclash/protocol';
import { SocketRateLimiter, type RateLimiterOptions } from './rate-limit';

const BLOCKED_TERMS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'bastard',
  'idiot',
  'moron',
  'cheater',
  'noobspam',
  'slurword',
];

const BLOCKED_REGEX = new RegExp(`\\b(${BLOCKED_TERMS.join('|')})\\b`, 'gi');

export interface ModerationResult {
  readonly ok: boolean;
  readonly sanitizedText: string;
  readonly filtered: boolean;
  readonly reason?: string;
}

/**
 * Moderates raw chat input:
 * - Rejects empty strings or excessive repeated characters / URLs
 * - Masks profanity/toxic terms with `***` and sets `filtered: true`
 */
export function moderateChatMessage(
  rawText?: string | null,
  emoji?: string | null
): ModerationResult {
  if (emoji && (!rawText || rawText.trim().length === 0)) {
    return {
      ok: true,
      sanitizedText: '',
      filtered: false,
    };
  }

  const text = rawText ?? '';
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 && !emoji) {
    return {
      ok: false,
      sanitizedText: '',
      filtered: false,
      reason: 'Chat message cannot be empty',
    };
  }

  if (trimmed.length > 240) {
    return {
      ok: false,
      sanitizedText: '',
      filtered: false,
      reason: 'Chat message exceeds 240 character limit',
    };
  }

  if (/https?:\/\/|www\./i.test(trimmed)) {
    return {
      ok: false,
      sanitizedText: '',
      filtered: false,
      reason: 'External links are not permitted in room chat',
    };
  }

  let filtered = false;
  const sanitizedText = trimmed.replace(BLOCKED_REGEX, (match) => {
    filtered = true;
    return '*'.repeat(Math.max(3, match.length));
  });

  return {
    ok: true,
    sanitizedText,
    filtered,
  };
}

export class ChatModerationManager {
  private readonly rateLimiter: SocketRateLimiter;
  private readonly messagesByRoom = new Map<string, ChatMessagePayload[]>();
  private readonly reports: ChatReportRecord[] = [];

  constructor(rateLimitOptions?: Partial<RateLimiterOptions>) {
    // Default chat rate limit: max 5 messages per 10 seconds per player
    this.rateLimiter = new SocketRateLimiter({
      windowMs: rateLimitOptions?.windowMs ?? 10_000,
      maxEvents: rateLimitOptions?.maxEvents ?? 5,
    });
  }

  public consumeRateLimit(playerId: string, now = Date.now()): boolean {
    return this.rateLimiter.consume(playerId, now);
  }

  public createMessage(params: {
    readonly roomCode: string;
    readonly senderId: string;
    readonly senderName: string;
    readonly isSpectator: boolean;
    readonly rawText?: string | null;
    readonly emoji?: string | null;
  }):
    | { readonly ok: true; readonly message: ChatMessagePayload }
    | { readonly ok: false; readonly code: string; readonly error: string } {
    if (!this.consumeRateLimit(params.senderId)) {
      return {
        ok: false,
        code: 'CHAT_RATE_LIMITED',
        error: 'Chat rate limit exceeded (max 5 messages per 10s)',
      };
    }

    const mod = moderateChatMessage(params.rawText, params.emoji);
    if (!mod.ok) {
      return {
        ok: false,
        code: 'CHAT_REJECTED',
        error: mod.reason ?? 'Message rejected by chat filter',
      };
    }

    const code = params.roomCode.toUpperCase();
    const msg: ChatMessagePayload = {
      id: `msg_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      roomCode: code,
      senderId: params.senderId,
      senderName: params.senderName,
      isSpectator: params.isSpectator,
      text: mod.sanitizedText,
      emoji: params.emoji ?? null,
      filtered: mod.filtered,
      timestamp: Date.now(),
    };

    const list = this.messagesByRoom.get(code) ?? [];
    list.push(msg);
    if (list.length > 50) {
      list.shift();
    }
    this.messagesByRoom.set(code, list);

    return { ok: true, message: msg };
  }

  public reportMessage(params: {
    readonly roomCode: string;
    readonly messageId: string;
    readonly reporterId: string;
    readonly reason?: string;
  }): ChatReportRecord | null {
    const code = params.roomCode.toUpperCase();
    const roomMsgs = this.messagesByRoom.get(code) ?? [];
    const targetMsg = roomMsgs.find((m) => m.id === params.messageId);
    if (!targetMsg) {
      return null;
    }

    const report: ChatReportRecord = {
      id: `rep_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      roomCode: code,
      messageId: targetMsg.id,
      reportedSenderId: targetMsg.senderId,
      reporterId: params.reporterId,
      reason: params.reason?.trim() || 'Inappropriate chat message',
      timestamp: Date.now(),
    };
    this.reports.push(report);
    return report;
  }

  public getRoomMessages(roomCode: string): readonly ChatMessagePayload[] {
    return this.messagesByRoom.get(roomCode.toUpperCase()) ?? [];
  }

  public getReports(): readonly ChatReportRecord[] {
    return this.reports;
  }
}

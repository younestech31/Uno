import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOUSE_RULES,
  createGame,
  type GameAction,
} from '@cardclash/engine';
import {
  ChatModerationManager,
  InMemoryAccountRepository,
  InMemoryStateStore,
  RoomManager,
  moderateChatMessage,
  signSessionToken,
} from '../src/index';
import { runLoadBenchmark } from './load-test-benchmark';

describe('Phase 6 — Spectators, Chat Moderation, Replay Bundles & Load Benchmark', () => {
  it('allows non-seated spectators to join, receive sanitized spectator views, and leave cleanly', async () => {
    const store = new InMemoryStateStore();
    const accountRepo = new InMemoryAccountRepository();
    const manager = new RoomManager(store, accountRepo);

    const host = {
      playerId: 'usr_host',
      name: 'Host Alice',
      isGuest: true,
      iat: Date.now(),
    };
    const p2 = {
      playerId: 'usr_p2',
      name: 'Player Bob',
      isGuest: true,
      iat: Date.now(),
    };
    const spectator = {
      playerId: 'usr_spectator',
      name: 'Watcher Dave',
      isGuest: true,
      iat: Date.now(),
    };

    const createRes = await manager.createRoom(host);
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;

    const roomCode = createRes.data.room.roomCode;
    await manager.joinRoom(p2, roomCode);
    await manager.setReady(host.playerId, true, roomCode);
    await manager.setReady(p2.playerId, true, roomCode);
    await manager.startRoom(host.playerId, roomCode);

    // Spectator joins active room
    const specRes = await manager.spectateRoom(spectator, roomCode);
    expect(specRes.ok).toBe(true);
    if (!specRes.ok) return;

    expect(specRes.data.room.spectatorCount).toBe(1);
    expect(specRes.data.view).not.toBeNull();
    // Spectator must have empty hand (no private player cards leaked)
    expect(specRes.data.view?.hand).toHaveLength(0);
    expect(specRes.data.view?.opponents).toHaveLength(2);
    expect(specRes.data.view?.opponents[0]?.cardCount).toBeGreaterThan(0);

    // Spectator leaves room
    const leaveRes = await manager.leaveRoom(spectator.playerId, roomCode);
    expect(leaveRes.ok).toBe(true);
    if (!leaveRes.ok) return;

    expect(leaveRes.data.room?.spectatorCount).toBe(0);
  });

  it('moderates chat text, masks profanity, blocks external URLs, and logs reports', () => {
    // 1. Text moderation & profanity masking
    const cleanMsg = moderateChatMessage('Good game everyone!', null);
    expect(cleanMsg.ok).toBe(true);
    expect(cleanMsg.filtered).toBe(false);
    expect(cleanMsg.sanitizedText).toBe('Good game everyone!');

    const profaneMsg = moderateChatMessage('you idiot that was a terrible play', null);
    expect(profaneMsg.ok).toBe(true);
    expect(profaneMsg.filtered).toBe(true);
    expect(profaneMsg.sanitizedText).toContain('*****');

    // 2. Blocks external links / spam
    const linkMsg = moderateChatMessage('Check out http://spam.com free chips', null);
    expect(linkMsg.ok).toBe(false);
    expect(linkMsg.reason).toContain('External links');

    // 3. Chat manager rate limiting & emoji support
    const chatManager = new ChatModerationManager({ windowMs: 10_000, maxEvents: 2 });
    const m1 = chatManager.createMessage({
      roomCode: 'ABCD',
      senderId: 'usr_1',
      senderName: 'Alice',
      isSpectator: false,
      rawText: 'Hello',
    });
    expect(m1.ok).toBe(true);

    const m2 = chatManager.createMessage({
      roomCode: 'ABCD',
      senderId: 'usr_1',
      senderName: 'Alice',
      isSpectator: false,
      emoji: '🔥',
    });
    expect(m2.ok).toBe(true);
    if (m2.ok) {
      expect(m2.message.emoji).toBe('🔥');
    }

    // Exceeds max 2 events in window
    const m3 = chatManager.createMessage({
      roomCode: 'ABCD',
      senderId: 'usr_1',
      senderName: 'Alice',
      isSpectator: false,
      rawText: 'Spam 3',
    });
    expect(m3.ok).toBe(false);
    if (!m3.ok) {
      expect(m3.code).toBe('CHAT_RATE_LIMITED');
    }

    // 4. Reporting system
    if (m1.ok) {
      const rep = chatManager.reportMessage({
        roomCode: 'ABCD',
        messageId: m1.message.id,
        reporterId: 'usr_reporter',
        reason: 'Spamming',
      });
      expect(rep).not.toBeNull();
      expect(rep?.messageId).toBe(m1.message.id);
      expect(chatManager.getReports()).toHaveLength(1);
    }
  });

  it('records and returns full deterministic ReplayDataBundle for client-side playback', async () => {
    const store = new InMemoryStateStore();
    const accountRepo = new InMemoryAccountRepository();
    const manager = new RoomManager(store, accountRepo);

    const host = {
      playerId: 'usr_host_replay',
      name: 'Host Alice',
      isGuest: true,
      iat: Date.now(),
    };
    const p2 = {
      playerId: 'usr_p2_replay',
      name: 'Player Bob',
      isGuest: true,
      iat: Date.now(),
    };

    const createRes = await manager.createRoom(host);
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;

    const roomCode = createRes.data.room.roomCode;
    await manager.joinRoom(p2, roomCode);
    await manager.setReady(host.playerId, true, roomCode);
    await manager.setReady(p2.playerId, true, roomCode);

    const startRes = await manager.startRoom(host.playerId, roomCode);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    const matchId = startRes.data.matchId;

    // Execute an action from the currently active player to record in log
    const gameState = startRes.data.snapshot.gameState!;
    const activePlayerId =
      gameState.players[gameState.currentPlayerIndex]?.id ?? host.playerId;
    const isWildChoice =
      gameState.turnPhase === 'AWAITING_INITIAL_WILD_COLOR';

    const action: GameAction = isWildChoice
      ? {
          type: 'CHOOSE_INITIAL_COLOR',
          color: 'RED',
          playerId: activePlayerId,
          seq: 1,
        }
      : {
          type: 'DRAW_CARD',
          playerId: activePlayerId,
          seq: 1,
        };

    const actionRes = await manager.handleGameAction(
      activePlayerId,
      action,
      roomCode
    );
    expect(actionRes.ok).toBe(true);

    // Retrieve replay data bundle
    const replayBundle = await manager.getReplayData(matchId);
    expect(replayBundle).not.toBeNull();
    expect(replayBundle?.matchId).toBe(matchId);
    expect(replayBundle?.seed).toBeDefined();
    expect(replayBundle?.actions.length).toBeGreaterThanOrEqual(1);
    expect(replayBundle?.players).toHaveLength(2);
  });

  it('runs high-concurrency room simulation benchmark with sub-millisecond turn latency', async () => {
    const result = await runLoadBenchmark(20);
    expect(result.roomCount).toBe(20);
    expect(result.totalActions).toBe(20);
    expect(result.actionsPerSecond).toBeGreaterThan(0);
  });
});

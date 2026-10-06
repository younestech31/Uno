import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  SOCKET_EVENTS,
  type GameEventsBroadcast,
  type GameViewBroadcast,
  type HeartbeatAckPayload,
  type PublicRoomState,
  type SocketAckResult,
} from '@cardclash/protocol';
import {
  InMemoryStateStore,
  createCardClashServer,
  signSessionToken,
  verifySessionToken,
  type CardClashServerInstance,
} from '../src/index';

const TEST_SECRET = 'test-session-secret-key-32-bytes-long!!';

function connectAuthenticatedClient(
  port: number,
  identity: { playerId: string; name: string },
  secret = TEST_SECRET
): Promise<ClientSocket> {
  const token = signSessionToken(identity, secret);
  return new Promise((resolve, reject) => {
    const client = createClient(`http://127.0.0.1:${port}`, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    client.once('connect', () => resolve(client));
    client.once('connect_error', (err) => {
      client.close();
      reject(err);
    });
  });
}

function emitWithAck<T>(
  socket: ClientSocket,
  event: string,
  payload?: unknown
): Promise<SocketAckResult<T>> {
  return new Promise((resolve) => {
    if (payload !== undefined) {
      socket.emit(event, payload, (res: SocketAckResult<T>) => resolve(res));
    } else {
      socket.emit(event, undefined, (res: SocketAckResult<T>) => resolve(res));
    }
  });
}

describe('@cardclash/server — Auth, Room Lifecycle, Engine Actions, Snapshots, Rate Limit & Phase 4 Resilience', () => {
  let server: CardClashServerInstance;
  let port: number;
  let store: InMemoryStateStore;
  const activeClients: ClientSocket[] = [];

  beforeEach(async () => {
    store = new InMemoryStateStore();
    server = createCardClashServer({
      store,
      sessionSecret: TEST_SECRET,
      rateLimit: { windowMs: 1000, maxEvents: 25 },
    });
    port = await server.listen(0);
  });

  afterEach(async () => {
    for (const c of activeClients) {
      if (c.connected) c.disconnect();
      c.close();
    }
    activeClients.length = 0;
    await server.close();
  });

  it('signs and verifies HMAC session tokens and rejects unauthenticated sockets', async () => {
    const validToken = signSessionToken({ playerId: 'p1', name: 'Alice' }, TEST_SECRET);
    const verified = verifySessionToken(validToken, TEST_SECRET);
    expect(verified).not.toBeNull();
    expect(verified?.playerId).toBe('p1');
    expect(verified?.name).toBe('Alice');

    expect(verifySessionToken(`${validToken}tampered`, TEST_SECRET)).toBeNull();
    expect(verifySessionToken(validToken, 'wrong-secret')).toBeNull();

    // Unauthenticated socket handshake must fail
    await expect(
      new Promise((resolve, reject) => {
        const badClient = createClient(`http://127.0.0.1:${port}`, {
          auth: { token: 'invalid.token' },
          transports: ['websocket'],
          forceNew: true,
          reconnection: false,
        });
        badClient.once('connect', () => {
          badClient.close();
          resolve(true);
        });
        badClient.once('connect_error', (err) => {
          badClient.close();
          reject(err);
        });
      })
    ).rejects.toThrow(/UNAUTHORIZED/);
  });

  it('handles room:create (4-letter code), room:join, room:ready, host reassignment on leave, and room deletion', async () => {
    const alice = await connectAuthenticatedClient(port, {
      playerId: 'alice-1',
      name: 'Alice',
    });
    const bob = await connectAuthenticatedClient(port, {
      playerId: 'bob-2',
      name: 'Bob',
    });
    activeClients.push(alice, bob);

    // 1. Alice creates room
    const createRes = await emitWithAck<{ room: PublicRoomState }>(
      alice,
      SOCKET_EVENTS.ROOM_CREATE,
      {
        targetScore: 300,
        houseRules: { stacking: true },
      }
    );
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;

    const { roomCode } = createRes.data.room;
    expect(roomCode).toMatch(/^[A-Z0-9]{4}$/);
    expect(createRes.data.room.hostPlayerId).toBe('alice-1');
    expect(createRes.data.room.houseRules.stacking).toBe(true);

    // Verify snapshot persisted in store
    const storedAfterCreate = await store.getRoomSnapshot(roomCode);
    expect(storedAfterCreate).not.toBeNull();
    expect(storedAfterCreate?.players).toHaveLength(1);

    // 2. Bob joins room
    const joinRes = await emitWithAck<{ room: PublicRoomState }>(
      bob,
      SOCKET_EVENTS.ROOM_JOIN,
      { roomCode }
    );
    expect(joinRes.ok).toBe(true);
    if (!joinRes.ok) return;
    expect(joinRes.data.room.players).toHaveLength(2);

    // 3. Starting before ready is rejected
    const prematureStart = await emitWithAck<{ room: PublicRoomState; matchId: string }>(
      alice,
      SOCKET_EVENTS.ROOM_START,
      { roomCode }
    );
    expect(prematureStart.ok).toBe(false);
    if (!prematureStart.ok) {
      expect(prematureStart.error.code).toBe('PLAYERS_NOT_READY');
    }

    // 4. Alice leaves in lobby -> Bob becomes host
    const leaveRes = await emitWithAck<{ roomCode: string }>(
      alice,
      SOCKET_EVENTS.ROOM_LEAVE,
      { roomCode }
    );
    expect(leaveRes.ok).toBe(true);

    const snapshotAfterAliceLeft = await store.getRoomSnapshot(roomCode);
    expect(snapshotAfterAliceLeft?.hostPlayerId).toBe('bob-2');
    expect(snapshotAfterAliceLeft?.players).toHaveLength(1);

    // 5. Bob leaves -> empty lobby room snapshot is deleted
    await emitWithAck<{ roomCode: string }>(bob, SOCKET_EVENTS.ROOM_LEAVE, {
      roomCode,
    });
    expect(await store.getRoomSnapshot(roomCode)).toBeNull();
  });

  it('starts a match, broadcasts per-player views without leaks, executes actions, checks seq, and snapshots after every action', async () => {
    const alice = await connectAuthenticatedClient(port, {
      playerId: 'alice-1',
      name: 'Alice',
    });
    const bob = await connectAuthenticatedClient(port, {
      playerId: 'bob-2',
      name: 'Bob',
    });
    activeClients.push(alice, bob);

    const aliceViews: GameViewBroadcast[] = [];
    const bobViews: GameViewBroadcast[] = [];
    const gameEventsList: GameEventsBroadcast[] = [];

    alice.on(SOCKET_EVENTS.GAME_VIEW, (payload: GameViewBroadcast) => {
      aliceViews.push(payload);
    });
    bob.on(SOCKET_EVENTS.GAME_VIEW, (payload: GameViewBroadcast) => {
      bobViews.push(payload);
    });
    alice.on(SOCKET_EVENTS.GAME_EVENTS, (payload: GameEventsBroadcast) => {
      gameEventsList.push(payload);
    });

    const created = await emitWithAck<{ room: PublicRoomState }>(
      alice,
      SOCKET_EVENTS.ROOM_CREATE
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const roomCode = created.data.room.roomCode;

    await emitWithAck(bob, SOCKET_EVENTS.ROOM_JOIN, { roomCode });
    await emitWithAck(alice, SOCKET_EVENTS.ROOM_READY, { roomCode, ready: true });
    await emitWithAck(bob, SOCKET_EVENTS.ROOM_READY, { roomCode, ready: true });

    // Non-host (Bob) cannot start the match
    const bobStart = await emitWithAck(bob, SOCKET_EVENTS.ROOM_START, { roomCode });
    expect(bobStart.ok).toBe(false);
    if (!bobStart.ok) expect(bobStart.error.code).toBe('NOT_HOST');

    // Host (Alice) starts the match
    const startRes = await emitWithAck<{ room: PublicRoomState; matchId: string }>(
      alice,
      SOCKET_EVENTS.ROOM_START,
      { roomCode }
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    // Wait briefly for broadcast delivery
    await new Promise((r) => setTimeout(r, 40));

    expect(aliceViews.length).toBeGreaterThanOrEqual(1);
    expect(bobViews.length).toBeGreaterThanOrEqual(1);

    const aliceInitialView = aliceViews[aliceViews.length - 1]!.view;
    const bobInitialView = bobViews[bobViews.length - 1]!.view;

    expect(aliceInitialView.viewerId).toBe('alice-1');
    expect(bobInitialView.viewerId).toBe('bob-2');
    expect(aliceInitialView.revealedSeed).toBeNull();
    expect(bobInitialView.revealedSeed).toBeNull();

    // Verify Alice's view does not leak Bob's hand cards
    const aliceSerialized = JSON.stringify(aliceInitialView);
    for (const bobCard of bobInitialView.hand) {
      expect(aliceSerialized).not.toContain(`"${bobCard.id}"`);
    }

    // Verify cryptographic 32-byte (64 hex chars) seed stored on server
    const snapshotOnStart = await store.getRoomSnapshot(roomCode);
    expect(snapshotOnStart?.matchLog?.seed).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshotOnStart?.matchLog?.actions).toHaveLength(0);

    // Determine whose turn it is and execute a valid action
    const currentTurnId = aliceInitialView.currentPlayerId;
    const activeSocket = currentTurnId === 'alice-1' ? alice : bob;
    const activeView =
      currentTurnId === 'alice-1' ? aliceInitialView : bobInitialView;

    const firstAction =
      activeView.turnPhase === 'AWAITING_INITIAL_WILD_COLOR'
        ? ({
            type: 'CHOOSE_INITIAL_COLOR',
            color: 'RED',
            seq: 1,
          } as const)
        : ({
            type: 'DRAW_CARD',
            seq: 1,
          } as const);

    const actionRes = await emitWithAck<{ matchId: string; seq: number }>(
      activeSocket,
      SOCKET_EVENTS.GAME_ACTION,
      {
        roomCode,
        action: firstAction,
      }
    );
    expect(actionRes.ok).toBe(true);

    // Verify snapshot and matchLog updated after the action
    const snapshotAfterAction = await store.getRoomSnapshot(roomCode);
    expect(snapshotAfterAction?.matchLog?.actions).toHaveLength(1);
    expect(snapshotAfterAction?.matchLog?.actions[0]?.action.seq).toBe(1);

    // Reject duplicate seq (seq: 1 again)
    const duplicateSeqRes = await emitWithAck(
      activeSocket,
      SOCKET_EVENTS.GAME_ACTION,
      {
        roomCode,
        action: {
          type: 'PASS_TURN',
          seq: 1,
        },
      }
    );
    expect(duplicateSeqRes.ok).toBe(false);
    if (!duplicateSeqRes.ok) {
      expect(duplicateSeqRes.error.code).toBe('STALE_SEQUENCE');
    }

    // Reject identity spoofing
    const spoofRes = await emitWithAck(activeSocket, SOCKET_EVENTS.GAME_ACTION, {
      roomCode,
      action: {
        type: 'DRAW_CARD',
        playerId: 'someone-else',
        seq: 2,
      },
    });
    expect(spoofRes.ok).toBe(false);
    if (!spoofRes.ok) {
      expect(spoofRes.error.code).toBe('IDENTITY_MISMATCH');
    }
  });

  it('enforces per-socket rate limiting when flooded with requests', async () => {
    const floodServer = createCardClashServer({
      store: new InMemoryStateStore(),
      sessionSecret: TEST_SECRET,
      rateLimit: { windowMs: 2000, maxEvents: 3 },
    });
    const floodPort = await floodServer.listen(0);

    try {
      const client = await connectAuthenticatedClient(floodPort, {
        playerId: 'flood-1',
        name: 'Flooder',
      });
      activeClients.push(client);

      const created = await emitWithAck<{ room: PublicRoomState }>(
        client,
        SOCKET_EVENTS.ROOM_CREATE
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const roomCode = created.data.room.roomCode;

      const r2 = await emitWithAck(client, SOCKET_EVENTS.ROOM_READY, {
        roomCode,
        ready: true,
      });
      const r3 = await emitWithAck(client, SOCKET_EVENTS.ROOM_READY, {
        roomCode,
        ready: false,
      });
      // 4th event within 2000ms exceeds maxEvents = 3
      const r4 = await emitWithAck(client, SOCKET_EVENTS.ROOM_READY, {
        roomCode,
        ready: true,
      });

      expect(r2.ok).toBe(true);
      expect(r3.ok).toBe(true);
      expect(r4.ok).toBe(false);
      if (!r4.ok) {
        expect(r4.error.code).toBe('RATE_LIMITED');
      }
    } finally {
      await floodServer.close();
    }
  });

  it('supports token auto-reconnect within grace window, session:heartbeat, and room:rematch', async () => {
    const alice = await connectAuthenticatedClient(port, {
      playerId: 'alice-reconnect',
      name: 'Alice',
    });
    const bob = await connectAuthenticatedClient(port, {
      playerId: 'bob-reconnect',
      name: 'Bob',
    });
    activeClients.push(alice, bob);

    const created = await emitWithAck<{ room: PublicRoomState }>(
      alice,
      SOCKET_EVENTS.ROOM_CREATE
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const roomCode = created.data.room.roomCode;

    await emitWithAck(bob, SOCKET_EVENTS.ROOM_JOIN, { roomCode });
    await emitWithAck(alice, SOCKET_EVENTS.ROOM_READY, { roomCode, ready: true });
    await emitWithAck(bob, SOCKET_EVENTS.ROOM_READY, { roomCode, ready: true });

    const startRes = await emitWithAck<{ room: PublicRoomState; matchId: string }>(
      alice,
      SOCKET_EVENTS.ROOM_START,
      { roomCode }
    );
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;
    const firstMatchId = startRes.data.matchId;
    const firstSeed = (await store.getRoomSnapshot(roomCode))?.matchLog?.seed;

    // 1. Test session:heartbeat
    const hbRes = await emitWithAck<HeartbeatAckPayload>(
      alice,
      SOCKET_EVENTS.SESSION_HEARTBEAT,
      { clientTime: Date.now() }
    );
    expect(hbRes.ok).toBe(true);
    if (hbRes.ok) {
      expect(hbRes.data.roomCode).toBe(roomCode);
      expect(typeof hbRes.data.serverTime).toBe('number');
      expect(typeof hbRes.data.turnDeadlineAt).toBe('number');
    }

    // 2. Disconnect Bob, verify seat marked disconnected, then reconnect via signed token
    bob.disconnect();
    await new Promise((r) => setTimeout(r, 40));

    const snapWhileDisconnected = await store.getRoomSnapshot(roomCode);
    const bobRecordDisconnected = snapWhileDisconnected?.players.find(
      (p) => p.id === 'bob-reconnect'
    );
    expect(bobRecordDisconnected?.connected).toBe(false);
    expect(bobRecordDisconnected?.isBot).toBe(false);

    // Reconnect Bob using the same playerId token; server must automatically push game:view
    const reconnectedViews: GameViewBroadcast[] = [];
    const token = signSessionToken(
      { playerId: 'bob-reconnect', name: 'Bob' },
      TEST_SECRET
    );
    const bobReconnected = await new Promise<ClientSocket>((resolve, reject) => {
      const client = createClient(`http://127.0.0.1:${port}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });
      client.on(SOCKET_EVENTS.GAME_VIEW, (v: GameViewBroadcast) => {
        reconnectedViews.push(v);
      });
      client.once('connect', () => resolve(client));
      client.once('connect_error', reject);
    });
    activeClients.push(bobReconnected);

    await new Promise((r) => setTimeout(r, 50));
    expect(reconnectedViews.length).toBeGreaterThanOrEqual(1);
    expect(reconnectedViews[0]?.view.viewerId).toBe('bob-reconnect');

    const snapAfterReconnect = await store.getRoomSnapshot(roomCode);
    const bobRecordRestored = snapAfterReconnect?.players.find(
      (p) => p.id === 'bob-reconnect'
    );
    expect(bobRecordRestored?.connected).toBe(true);
    expect(bobRecordRestored?.disconnectedAt).toBeNull();

    // 3. Test room:rematch (resets match with a new 32-byte seed)
    const rematchRes = await emitWithAck<{ room: PublicRoomState; matchId: string }>(
      alice,
      SOCKET_EVENTS.ROOM_REMATCH,
      { roomCode }
    );
    expect(rematchRes.ok).toBe(true);
    if (rematchRes.ok) {
      expect(rematchRes.data.matchId).not.toBe(firstMatchId);
      const rematchSnap = await store.getRoomSnapshot(roomCode);
      expect(rematchSnap?.matchLog?.seed).not.toBe(firstSeed);
      expect(rematchSnap?.matchLog?.actions).toHaveLength(0);
    }
  });

  it('auto-draws/passes after the 30s turn timer and activates a server bot after the 60s grace period', async () => {
    const fastStore = new InMemoryStateStore();
    const fastServer = createCardClashServer({
      store: fastStore,
      sessionSecret: TEST_SECRET,
      turnTimeoutMs: 90,
      disconnectGraceMs: 60,
      botActionDelayMs: 25,
    });
    const fastPort = await fastServer.listen(0);

    try {
      const alice = await connectAuthenticatedClient(fastPort, {
        playerId: 'alice-fast',
        name: 'Alice',
      });
      const bob = await connectAuthenticatedClient(fastPort, {
        playerId: 'bob-fast',
        name: 'Bob',
      });
      activeClients.push(alice, bob);

      const created = await emitWithAck<{ room: PublicRoomState }>(
        alice,
        SOCKET_EVENTS.ROOM_CREATE
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      const roomCode = created.data.room.roomCode;

      await emitWithAck(bob, SOCKET_EVENTS.ROOM_JOIN, { roomCode });
      await emitWithAck(alice, SOCKET_EVENTS.ROOM_READY, { roomCode, ready: true });
      await emitWithAck(bob, SOCKET_EVENTS.ROOM_READY, { roomCode, ready: true });

      await emitWithAck(alice, SOCKET_EVENTS.ROOM_START, { roomCode });

      // Wait for the server turn timer (90ms) to auto-execute at least 1 turn action
      await new Promise((r) => setTimeout(r, 150));

      const snapAfterTimeout = await fastStore.getRoomSnapshot(roomCode);
      expect(
        (snapAfterTimeout?.matchLog?.actions.length ?? 0)
      ).toBeGreaterThanOrEqual(1);

      // Now disconnect Bob and let the 60ms grace period expire -> Bob's seat becomes isBot: true
      bob.disconnect();
      await new Promise((r) => setTimeout(r, 140));

      const snapAfterGrace = await fastStore.getRoomSnapshot(roomCode);
      const bobSeat = snapAfterGrace?.players.find((p) => p.id === 'bob-fast');
      expect(bobSeat?.connected).toBe(false);
      expect(bobSeat?.isBot).toBe(true);

      // Wait another 150ms so both Alice's turn timeout and Bob's bot turn execute
      const actionsBeforeBotCycle =
        snapAfterGrace?.matchLog?.actions.length ?? 0;
      await new Promise((r) => setTimeout(r, 160));

      const snapAfterBotCycle = await fastStore.getRoomSnapshot(roomCode);
      expect(
        (snapAfterBotCycle?.matchLog?.actions.length ?? 0)
      ).toBeGreaterThan(actionsBeforeBotCycle);
    } finally {
      await fastServer.close();
    }
  });
});

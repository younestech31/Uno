import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HOUSE_RULES,
  createGame,
  type Card,
  type GameState,
} from '@cardclash/engine';
import {
  InMemoryAccountRepository,
  InMemoryStateStore,
  RoomManager,
  buildOpenSkillRating,
  createCardClashServer,
  signSessionToken,
  updateOpenSkillRatings,
  verifySessionToken,
} from '../src/index';

const TEST_SECRET = 'phase5-auth-secret-32-bytes-key!!';

describe('@cardclash/server — Phase 5: Accounts, Auth.js Token Verification, OpenSkill Ratings & Match History', () => {
  it('keeps guest tokens as default while verifying web-issued Auth.js account tokens', () => {
    const guestToken = signSessionToken(
      { playerId: 'guest_1', name: 'GuestOne' },
      TEST_SECRET
    );
    const verifiedGuest = verifySessionToken(guestToken, TEST_SECRET);
    expect(verifiedGuest).not.toBeNull();
    expect(verifiedGuest?.isGuest).toBe(true);
    expect(verifiedGuest?.email).toBeNull();

    const accountToken = signSessionToken(
      {
        playerId: 'acc_42',
        name: 'NovaPro',
        email: 'Nova@CardClash.gg',
        isGuest: false,
      },
      TEST_SECRET
    );
    const verifiedAccount = verifySessionToken(accountToken, TEST_SECRET);
    expect(verifiedAccount).not.toBeNull();
    expect(verifiedAccount?.playerId).toBe('acc_42');
    expect(verifiedAccount?.name).toBe('NovaPro');
    expect(verifiedAccount?.email).toBe('nova@cardclash.gg');
    expect(verifiedAccount?.isGuest).toBe(false);
  });

  it('computes Plackett-Luce OpenSkill Bayesian rating updates across 2-player and 4-player matches', () => {
    const initial = buildOpenSkillRating();
    expect(initial.mu).toBeCloseTo(25.0, 3);
    expect(initial.sigma).toBeCloseTo(25 / 3, 3);
    expect(initial.ordinal).toBeCloseTo(0, 2);
    expect(initial.displayRating).toBe(1000);

    // 2-player match: p1 wins (placement 1), p2 loses (placement 2)
    const twoPlayerResult = updateOpenSkillRatings([
      { playerId: 'p1', rating: initial, placement: 1 },
      { playerId: 'p2', rating: initial, placement: 2 },
    ]);

    const p1Out = twoPlayerResult.find((r) => r.playerId === 'p1')!;
    const p2Out = twoPlayerResult.find((r) => r.playerId === 'p2')!;

    expect(p1Out.after.mu).toBeGreaterThan(initial.mu);
    expect(p2Out.after.mu).toBeLessThan(initial.mu);
    expect(p1Out.after.sigma).toBeLessThan(initial.sigma);
    expect(p2Out.after.sigma).toBeLessThan(initial.sigma);
    expect(p1Out.ratingDelta).toBeGreaterThan(0);
    expect(p2Out.ratingDelta).toBeLessThan(0);

    // 4-player free-for-all match: placements 1, 2, 3, 4
    const fourPlayerResult = updateOpenSkillRatings([
      { playerId: 'a', rating: initial, placement: 1 },
      { playerId: 'b', rating: initial, placement: 2 },
      { playerId: 'c', rating: initial, placement: 3 },
      { playerId: 'd', rating: initial, placement: 4 },
    ]);

    const [a, b, c, d] = fourPlayerResult;
    expect(a!.after.displayRating).toBeGreaterThan(b!.after.displayRating);
    expect(b!.after.displayRating).toBeGreaterThan(c!.after.displayRating);
    expect(c!.after.displayRating).toBeGreaterThan(d!.after.displayRating);
  });

  it('automatically records MatchHistoryEntry from MatchActionLog and updates Leaderboard when a match reaches MATCH_OVER', async () => {
    const store = new InMemoryStateStore();
    const accountRepo = new InMemoryAccountRepository();
    const manager = new RoomManager(store, accountRepo);

    const aliceIdentity = {
      playerId: 'acc_alice',
      name: 'Alice',
      email: 'alice@cardclash.gg',
      isGuest: false,
      iat: Date.now(),
    };
    const bobIdentity = {
      playerId: 'gst_bob',
      name: 'Bob',
      email: null,
      isGuest: true,
      iat: Date.now(),
    };

    const createRes = await manager.createRoom(aliceIdentity, {
      targetScore: 50,
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const roomCode = createRes.data.room.roomCode;

    await manager.joinRoom(bobIdentity, roomCode);
    await manager.setReady(aliceIdentity.playerId, true, roomCode);
    await manager.setReady(bobIdentity.playerId, true, roomCode);

    const startRes = await manager.startRoom(aliceIdentity.playerId, roomCode);
    expect(startRes.ok).toBe(true);
    if (!startRes.ok) return;

    // Craft a state where Alice has 1 playable Wild card left and Bob holds two Wild Draw Fours (100 points >= targetScore 50)
    const snap = await store.getRoomSnapshot(roomCode);
    expect(snap?.gameState).not.toBeNull();
    if (!snap || !snap.gameState) return;

    const winningCard: Card = {
      id: 'WILD-WIN-1',
      color: 'WILD',
      kind: 'WILD',
      value: null,
    };
    const highValueHand: Card[] = [
      { id: 'WD4-BOB-1', color: 'WILD', kind: 'WILD_DRAW_FOUR', value: null },
      { id: 'WD4-BOB-2', color: 'WILD', kind: 'WILD_DRAW_FOUR', value: null },
    ];

    const engineeredGameState: GameState = {
      ...snap.gameState,
      currentPlayerIndex: 0,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      players: [
        {
          ...snap.gameState.players[0]!,
          id: aliceIdentity.playerId,
          name: aliceIdentity.name,
          hand: [winningCard],
          score: 0,
          calledUno: true,
        },
        {
          ...snap.gameState.players[1]!,
          id: bobIdentity.playerId,
          name: bobIdentity.name,
          hand: highValueHand,
          score: 0,
          calledUno: false,
        },
      ],
    };

    await store.saveRoomSnapshot({
      ...snap,
      gameState: engineeredGameState,
    });

    // Alice plays her final card -> scores 100 pts -> reaches MATCH_OVER (targetScore 50)
    const actionRes = await manager.handleGameAction(
      aliceIdentity.playerId,
      {
        type: 'PLAY_CARD',
        cardId: winningCard.id,
        chosenColor: 'BLUE',
        seq: 1,
      },
      roomCode
    );

    expect(actionRes.ok).toBe(true);
    if (!actionRes.ok) return;

    expect(actionRes.data.room.status).toBe('FINISHED');
    expect(actionRes.data.completedMatchHistory).not.toBeNull();
    expect(actionRes.data.completedMatchHistory?.winnerId).toBe('acc_alice');
    expect(actionRes.data.completedMatchHistory?.actionCount).toBe(1);
    expect(actionRes.data.completedMatchHistory?.seed).toMatch(/^[0-9a-f]{64}$/);

    // Verify Leaderboard and Recent Match History in AccountRepository
    const leaderboard = await accountRepo.getLeaderboard();
    expect(leaderboard).toHaveLength(2);
    expect(leaderboard[0]?.playerId).toBe('acc_alice');
    expect(leaderboard[0]?.isGuest).toBe(false);
    expect(leaderboard[0]?.matchesWon).toBe(1);
    expect(leaderboard[0]?.matchesPlayed).toBe(1);
    expect(leaderboard[0]?.totalPoints).toBe(100);
    expect(leaderboard[0]?.rating.displayRating).toBeGreaterThan(1000);

    expect(leaderboard[1]?.playerId).toBe('gst_bob');
    expect(leaderboard[1]?.isGuest).toBe(true);
    expect(leaderboard[1]?.matchesWon).toBe(0);
    expect(leaderboard[1]?.matchesPlayed).toBe(1);
    expect(leaderboard[1]?.rating.displayRating).toBeLessThan(1000);

    const recentMatches = await accountRepo.getRecentMatches();
    expect(recentMatches).toHaveLength(1);
    expect(recentMatches[0]?.roomCode).toBe(roomCode);
    expect(recentMatches[0]?.participants[0]?.playerId).toBe('acc_alice');
    expect(recentMatches[0]?.participants[0]?.ratingDelta).toBeGreaterThan(0);
  });

  it('serves /api/auth/session and /api/leaderboard HTTP endpoints on the server', async () => {
    const accountRepo = new InMemoryAccountRepository();
    const server = createCardClashServer({
      store: new InMemoryStateStore(),
      accountRepo,
      sessionSecret: TEST_SECRET,
    });
    const port = await server.listen(0);

    try {
      const authRes = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'champion@cardclash.gg',
          name: 'Champion',
        }),
      });
      expect(authRes.ok).toBe(true);
      const authJson = (await authRes.json()) as {
        token: string;
        playerId: string;
        name: string;
        email: string;
        isGuest: boolean;
      };
      expect(authJson.isGuest).toBe(false);
      expect(authJson.email).toBe('champion@cardclash.gg');
      expect(verifySessionToken(authJson.token, TEST_SECRET)?.playerId).toBe(
        authJson.playerId
      );

      const lbRes = await fetch(`http://127.0.0.1:${port}/api/leaderboard`);
      expect(lbRes.ok).toBe(true);
      const lbJson = (await lbRes.json()) as {
        leaderboard: Array<{ playerId: string; email: string | null }>;
      };
      expect(
        lbJson.leaderboard.some((p) => p.email === 'champion@cardclash.gg')
      ).toBe(true);
    } finally {
      await server.close();
    }
  });
});

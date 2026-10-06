import { describe, expect, it } from 'vitest';
import {
  calculateHandPoints,
  createGame,
  createPrngState,
  createStandardDeck,
  fisherYatesShuffle,
  getCardPoints,
  getPlayerView,
  isPlayable,
  reduce,
  type Card,
  type GameState,
} from '../src/index';

const TEST_PLAYERS_2 = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
];

const TEST_PLAYERS_3 = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Charlie' },
];

const TEST_PLAYERS_4 = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Charlie' },
  { id: 'p4', name: 'Diana' },
];

function totalCardsInState(state: GameState): number {
  const handCards = state.players.reduce((sum, p) => sum + p.hand.length, 0);
  return handCards + state.drawPile.length + state.discardPile.length;
}

describe('@cardclash/engine — Deck & PRNG', () => {
  it('creates an exact 108-card standard deck with unique IDs', () => {
    const deck = createStandardDeck();
    expect(deck).toHaveLength(108);

    const uniqueIds = new Set(deck.map((c) => c.id));
    expect(uniqueIds.size).toBe(108);

    for (const color of ['RED', 'YELLOW', 'GREEN', 'BLUE'] as const) {
      const zeros = deck.filter(
        (c) => c.color === color && c.kind === 'NUMBER' && c.value === 0
      );
      expect(zeros).toHaveLength(1);

      for (let v = 1; v <= 9; v++) {
        const nums = deck.filter(
          (c) => c.color === color && c.kind === 'NUMBER' && c.value === v
        );
        expect(nums).toHaveLength(2);
      }

      for (const kind of ['SKIP', 'REVERSE', 'DRAW_TWO'] as const) {
        const actions = deck.filter((c) => c.color === color && c.kind === kind);
        expect(actions).toHaveLength(2);
      }
    }

    const wilds = deck.filter((c) => c.kind === 'WILD');
    const wd4s = deck.filter((c) => c.kind === 'WILD_DRAW_FOUR');
    expect(wilds).toHaveLength(4);
    expect(wd4s).toHaveLength(4);
  });

  it('produces deterministic Fisher-Yates shuffles for identical seeds', () => {
    const deck = createStandardDeck();
    const seed = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    const s1 = fisherYatesShuffle(deck, createPrngState(seed));
    const s2 = fisherYatesShuffle(deck, createPrngState(seed));
    const s3 = fisherYatesShuffle(deck, createPrngState('different-seed-9999'));

    expect(s1.shuffled.map((c) => c.id)).toEqual(s2.shuffled.map((c) => c.id));
    expect(s1.shuffled.map((c) => c.id)).not.toEqual(s3.shuffled.map((c) => c.id));
  });

  it('deals 7 cards to 2-4 players and supports up to 10 players via config', () => {
    const game4 = createGame({
      matchId: 'm-4',
      seed: 'seed-four-players',
      players: TEST_PLAYERS_4,
    });
    expect(game4.players).toHaveLength(4);
    expect(totalCardsInState(game4)).toBe(108);

    const tenPlayers = Array.from({ length: 10 }, (_, idx) => ({
      id: `p${idx + 1}`,
      name: `Player ${idx + 1}`,
    }));
    const game10 = createGame({
      matchId: 'm-10',
      seed: 'seed-ten-players',
      players: tenPlayers,
    });
    expect(game10.players).toHaveLength(10);
    expect(totalCardsInState(game10)).toBe(108);
  });
});

describe('@cardclash/engine — First Card Flip Rules', () => {
  it('never starts a round with a Wild Draw Four on the discard pile', () => {
    for (let i = 0; i < 60; i++) {
      const state = createGame({
        matchId: `m-wd4-${i}`,
        seed: `seed-check-first-card-${i}`,
        players: TEST_PLAYERS_3,
      });
      const topDiscard = state.discardPile[state.discardPile.length - 1]!;
      expect(topDiscard.kind).not.toBe('WILD_DRAW_FOUR');
      expect(totalCardsInState(state)).toBe(108);
    }
  });

  it('handles first card = WILD by letting first player pick the initial color and then act', () => {
    // Find a seed that flips a WILD first card
    let wildState: GameState | null = null;
    for (let i = 0; i < 300; i++) {
      const candidate = createGame({
        matchId: 'm-wild',
        seed: `find-wild-seed-${i}`,
        players: TEST_PLAYERS_3,
      });
      if (candidate.discardPile[0]!.kind === 'WILD') {
        wildState = candidate;
        break;
      }
    }
    expect(wildState).not.toBeNull();
    expect(wildState!.turnPhase).toBe('AWAITING_INITIAL_WILD_COLOR');
    expect(wildState!.currentColor).toBeNull();
    expect(wildState!.currentPlayerIndex).toBe(0);

    // Non-first player cannot pick initial color
    const wrongPlayer = reduce(wildState!, {
      type: 'CHOOSE_INITIAL_COLOR',
      playerId: 'p2',
      color: 'BLUE',
      seq: 1,
    });
    expect(wrongPlayer.ok).toBe(false);
    if (!wrongPlayer.ok) {
      expect(wrongPlayer.error.code).toBe('NOT_YOUR_TURN');
    }

    // First player picks BLUE and remains active in PLAY_OR_DRAW phase
    const chosen = reduce(wildState!, {
      type: 'CHOOSE_INITIAL_COLOR',
      playerId: 'p1',
      color: 'BLUE',
      seq: 1,
    });
    expect(chosen.ok).toBe(true);
    if (chosen.ok) {
      expect(chosen.state.currentColor).toBe('BLUE');
      expect(chosen.state.turnPhase).toBe('PLAY_OR_DRAW');
      expect(chosen.state.currentPlayerIndex).toBe(0);
    }
  });

  it('handles first card = SKIP, DRAW_TWO, and REVERSE (2p vs 3p)', () => {
    let skipState: GameState | null = null;
    let drawTwoState: GameState | null = null;
    let reverse3pState: GameState | null = null;
    let reverse2pState: GameState | null = null;

    for (let i = 0; i < 400; i++) {
      const seed = `first-card-special-${i}`;
      const s3 = createGame({
        matchId: 'm-3',
        seed,
        players: TEST_PLAYERS_3,
      });
      const firstKind = s3.discardPile[0]!.kind;
      if (firstKind === 'SKIP' && !skipState) skipState = s3;
      if (firstKind === 'DRAW_TWO' && !drawTwoState) drawTwoState = s3;
      if (firstKind === 'REVERSE' && !reverse3pState) reverse3pState = s3;

      const s2 = createGame({
        matchId: 'm-2',
        seed,
        players: TEST_PLAYERS_2,
      });
      if (s2.discardPile[0]!.kind === 'REVERSE' && !reverse2pState) {
        reverse2pState = s2;
      }

      if (skipState && drawTwoState && reverse3pState && reverse2pState) break;
    }

    // Skip: first player (index 0) skipped, index 1 acts
    expect(skipState).not.toBeNull();
    expect(skipState!.currentPlayerIndex).toBe(1);

    // Draw Two: first player (index 0) has 9 cards and is skipped, index 1 acts
    expect(drawTwoState).not.toBeNull();
    expect(drawTwoState!.players[0]!.hand).toHaveLength(9);
    expect(drawTwoState!.currentPlayerIndex).toBe(1);

    // Reverse (3 players): direction is -1, turn moves to player index 2
    expect(reverse3pState).not.toBeNull();
    expect(reverse3pState!.direction).toBe(-1);
    expect(reverse3pState!.currentPlayerIndex).toBe(2);

    // Reverse (2 players): acts as Skip on seat 0, seat 1 acts
    expect(reverse2pState).not.toBeNull();
    expect(reverse2pState!.direction).toBe(-1);
    expect(reverse2pState!.currentPlayerIndex).toBe(1);
  });
});

describe('@cardclash/engine — Card Legality, Reverse 2P, Draw/Play/Pass & Seq', () => {
  function createControlledState(overrides?: Partial<GameState>): GameState {
    const base = createGame({
      matchId: 'controlled',
      seed: 'controlled-seed-1',
      players: TEST_PLAYERS_2,
    });
    const redFive: Card = { id: 'RED-5-1', color: 'RED', kind: 'NUMBER', value: 5 };
    return {
      ...base,
      status: 'IN_PROGRESS',
      currentPlayerIndex: 0,
      direction: 1,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      discardPile: [redFive],
      ...overrides,
    };
  }

  it('enforces color, number, symbol, Wild, and strict Wild Draw Four legality', () => {
    const red3: Card = { id: 'RED-3-1', color: 'RED', kind: 'NUMBER', value: 3 };
    const blue5: Card = { id: 'BLUE-5-1', color: 'BLUE', kind: 'NUMBER', value: 5 };
    const green7: Card = { id: 'GREEN-7-1', color: 'GREEN', kind: 'NUMBER', value: 7 };
    const wild: Card = { id: 'WILD-1', color: 'WILD', kind: 'WILD', value: null };
    const wd4: Card = {
      id: 'WILD_DRAW_FOUR-1',
      color: 'WILD',
      kind: 'WILD_DRAW_FOUR',
      value: null,
    };

    const stateWithRedInHand = createControlledState({
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [red3, blue5, green7, wild, wd4],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [{ id: 'YELLOW-1-1', color: 'YELLOW', kind: 'NUMBER', value: 1 }],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
      ],
    });

    // Green 7 does not match RED-5
    const illegalGreen = reduce(stateWithRedInHand, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'GREEN-7-1',
      seq: 1,
    });
    expect(illegalGreen.ok).toBe(false);
    if (!illegalGreen.ok) expect(illegalGreen.error.code).toBe('ILLEGAL_PLAY');

    // Wild Draw Four is illegal because p1 holds RED-3-1 (matches currentColor RED)
    const illegalWd4 = reduce(stateWithRedInHand, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'WILD_DRAW_FOUR-1',
      chosenColor: 'BLUE',
      seq: 1,
    });
    expect(illegalWd4.ok).toBe(false);
    if (!illegalWd4.ok) {
      expect(illegalWd4.error.code).toBe('ILLEGAL_WILD_DRAW_FOUR');
    }

    // Matching number (BLUE-5 on RED-5) is legal and changes currentColor to BLUE
    const playBlue5 = reduce(stateWithRedInHand, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'BLUE-5-1',
      seq: 1,
    });
    expect(playBlue5.ok).toBe(true);
    if (playBlue5.ok) {
      expect(playBlue5.state.currentColor).toBe('BLUE');
      expect(playBlue5.state.currentPlayerIndex).toBe(1);
    }

    // If p1 has NO RED cards (even if holding BLUE-5 matching number), WILD_DRAW_FOUR is legal
    const stateWithoutRed = createControlledState({
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [blue5, green7, wd4],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [red3, wild],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
      ],
    });

    const legalWd4 = reduce(stateWithoutRed, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'WILD_DRAW_FOUR-1',
      chosenColor: 'GREEN',
      seq: 1,
    });
    expect(legalWd4.ok).toBe(true);
    if (legalWd4.ok) {
      expect(legalWd4.state.currentColor).toBe('GREEN');
      // In a 2-player game, p2 draws 4 and is skipped, so turn returns to p1 (index 0)
      expect(legalWd4.state.players[1]!.hand).toHaveLength(6);
      expect(legalWd4.state.currentPlayerIndex).toBe(0);
    }
  });

  it('treats Reverse as Skip in a 2-player game', () => {
    const redReverse: Card = {
      id: 'RED-REVERSE-1',
      color: 'RED',
      kind: 'REVERSE',
      value: null,
    };
    const red9: Card = { id: 'RED-9-1', color: 'RED', kind: 'NUMBER', value: 9 };

    const state = createControlledState({
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [redReverse, red9],
          score: 0,
          calledUno: true,
          preCalledUno: true,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [{ id: 'BLUE-2-1', color: 'BLUE', kind: 'NUMBER', value: 2 }],
          score: 0,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
      ],
    });

    const res = reduce(state, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'RED-REVERSE-1',
      seq: 1,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.direction).toBe(-1);
      // p2 was skipped, so it is immediately p1's turn again
      expect(res.state.currentPlayerIndex).toBe(0);
    }
  });

  it('handles draw 1 -> play drawn card if legal OR pass turn', () => {
    const red8: Card = { id: 'RED-8-1', color: 'RED', kind: 'NUMBER', value: 8 };
    const blue2: Card = { id: 'BLUE-2-1', color: 'BLUE', kind: 'NUMBER', value: 2 };
    const yellow3: Card = {
      id: 'YELLOW-3-1',
      color: 'YELLOW',
      kind: 'NUMBER',
      value: 3,
    };

    const state = createControlledState({
      drawPile: [red8, blue2],
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [yellow3],
          score: 0,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [blue2],
          score: 0,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
      ],
    });

    const drawn = reduce(state, {
      type: 'DRAW_CARD',
      playerId: 'p1',
      seq: 1,
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;

    expect(drawn.state.turnPhase).toBe('DRAWN_PLAY_OR_PASS');
    expect(drawn.state.pendingDrawnCardId).toBe('RED-8-1');

    // Cannot play a different card from hand during DRAWN_PLAY_OR_PASS
    const playOther = reduce(drawn.state, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'YELLOW-3-1',
      seq: 2,
    });
    expect(playOther.ok).toBe(false);
    if (!playOther.ok) expect(playOther.error.code).toBe('MUST_PLAY_DRAWN_CARD');

    // Can play the drawn RED-8-1 immediately
    const playDrawn = reduce(drawn.state, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'RED-8-1',
      seq: 2,
    });
    expect(playDrawn.ok).toBe(true);
    if (playDrawn.ok) {
      expect(playDrawn.state.turnPhase).toBe('PLAY_OR_DRAW');
      expect(playDrawn.state.currentPlayerIndex).toBe(1);
    }

    // Or can pass turn instead
    const passTurn = reduce(drawn.state, {
      type: 'PASS_TURN',
      playerId: 'p1',
      seq: 2,
    });
    expect(passTurn.ok).toBe(true);
    if (passTurn.ok) {
      expect(passTurn.state.turnPhase).toBe('PLAY_OR_DRAW');
      expect(passTurn.state.currentPlayerIndex).toBe(1);
      expect(passTurn.state.players[0]!.hand).toHaveLength(2);
    }
  });

  it('rejects stale or duplicate action sequence numbers', () => {
    const state = createControlledState({
      lastSeqByPlayer: { p1: 5, p2: 3 },
    });

    const duplicateSeq = reduce(state, {
      type: 'DRAW_CARD',
      playerId: 'p1',
      seq: 5,
    });
    expect(duplicateSeq.ok).toBe(false);
    if (!duplicateSeq.ok) expect(duplicateSeq.error.code).toBe('STALE_SEQUENCE');

    const staleSeq = reduce(state, {
      type: 'DRAW_CARD',
      playerId: 'p1',
      seq: 4,
    });
    expect(staleSeq.ok).toBe(false);
    if (!staleSeq.ok) expect(staleSeq.error.code).toBe('STALE_SEQUENCE');
  });
});

describe('@cardclash/engine — UNO Call & Catch Window, Reshuffle, Scoring', () => {
  it('enforces UNO call at 1 card and allows any player to catch before next player acts (draw 2)', () => {
    const base = createGame({
      matchId: 'uno-test',
      seed: 'uno-seed-1',
      players: TEST_PLAYERS_3,
    });
    const red5: Card = { id: 'RED-5-1', color: 'RED', kind: 'NUMBER', value: 5 };
    const red6: Card = { id: 'RED-6-1', color: 'RED', kind: 'NUMBER', value: 6 };
    const red7: Card = { id: 'RED-7-1', color: 'RED', kind: 'NUMBER', value: 7 };
    const blue1: Card = { id: 'BLUE-1-1', color: 'BLUE', kind: 'NUMBER', value: 1 };

    const state: GameState = {
      ...base,
      currentPlayerIndex: 0,
      direction: 1,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      discardPile: [red5],
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [red6, blue1],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [red7, blue1],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p3',
          name: 'Charlie',
          hand: [blue1, red5],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
      ],
    };

    // p1 plays down from 2 cards to 1 card without calling UNO
    const played = reduce(state, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'RED-6-1',
      seq: 1,
    });
    expect(played.ok).toBe(true);
    if (!played.ok) return;

    expect(played.state.unoVulnerablePlayerId).toBe('p1');
    expect(played.state.players[0]!.hand).toHaveLength(1);

    // Branch A: p1 calls UNO before anyone catches them
    const calledSafe = reduce(played.state, {
      type: 'CALL_UNO',
      playerId: 'p1',
      seq: 2,
    });
    expect(calledSafe.ok).toBe(true);
    if (calledSafe.ok) {
      expect(calledSafe.state.unoVulnerablePlayerId).toBeNull();
      expect(calledSafe.state.players[0]!.calledUno).toBe(true);

      // Now p3 trying to catch fails
      const lateCatch = reduce(calledSafe.state, {
        type: 'CATCH_UNO',
        playerId: 'p3',
        seq: 1,
      });
      expect(lateCatch.ok).toBe(false);
    }

    // Branch B: p3 catches p1 before p2 (next player) acts -> p1 draws 2 penalty cards
    const caught = reduce(played.state, {
      type: 'CATCH_UNO',
      playerId: 'p3',
      targetPlayerId: 'p1',
      seq: 1,
    });
    expect(caught.ok).toBe(true);
    if (caught.ok) {
      expect(caught.state.players[0]!.hand).toHaveLength(3);
      expect(caught.state.unoVulnerablePlayerId).toBeNull();
    }

    // Branch C: Next player (p2) acts before anyone catches p1 -> catch window closes
    const nextActed = reduce(played.state, {
      type: 'PLAY_CARD',
      playerId: 'p2',
      cardId: 'RED-7-1',
      seq: 1,
    });
    expect(nextActed.ok).toBe(true);
    if (nextActed.ok) {
      // p1's window expired (and now p2 is at 1 card)
      expect(nextActed.state.unoVulnerablePlayerId).toBe('p2');
    }
  });

  it('reshuffles discard pile keeping only the top card when draw pile is empty', () => {
    const base = createGame({
      matchId: 'reshuffle-test',
      seed: 'reshuffle-seed',
      players: TEST_PLAYERS_2,
    });

    const c1: Card = { id: 'RED-1-1', color: 'RED', kind: 'NUMBER', value: 1 };
    const c2: Card = { id: 'RED-2-1', color: 'RED', kind: 'NUMBER', value: 2 };
    const c3: Card = { id: 'RED-3-1', color: 'RED', kind: 'NUMBER', value: 3 };
    const top: Card = { id: 'RED-9-1', color: 'RED', kind: 'NUMBER', value: 9 };

    const emptyDrawState: GameState = {
      ...base,
      currentPlayerIndex: 0,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      drawPile: [],
      discardPile: [c1, c2, c3, top],
    };

    const res = reduce(emptyDrawState, {
      type: 'DRAW_CARD',
      playerId: 'p1',
      seq: 1,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.state.discardPile).toEqual([top]);
      expect(res.state.drawPile).toHaveLength(2);
      expect(res.events.some((e) => e.type === 'DECK_RESHUFFLED')).toBe(true);
    }
  });

  it('calculates round winner points accurately and ends match at targetScore', () => {
    const numCard: Card = { id: 'BLUE-7-1', color: 'BLUE', kind: 'NUMBER', value: 7 };
    const skipCard: Card = { id: 'GREEN-SKIP-1', color: 'GREEN', kind: 'SKIP', value: null };
    const wildCard: Card = { id: 'WILD-1', color: 'WILD', kind: 'WILD', value: null };
    const wd4Card: Card = {
      id: 'WILD_DRAW_FOUR-1',
      color: 'WILD',
      kind: 'WILD_DRAW_FOUR',
      value: null,
    };

    expect(getCardPoints(numCard)).toBe(7);
    expect(getCardPoints(skipCard)).toBe(20);
    expect(getCardPoints(wildCard)).toBe(50);
    expect(getCardPoints(wd4Card)).toBe(50);
    expect(calculateHandPoints([numCard, skipCard, wildCard, wd4Card])).toBe(127);

    const base = createGame({
      matchId: 'score-test',
      seed: 'score-seed',
      players: TEST_PLAYERS_2,
      targetScore: 500,
    });

    const winningCard: Card = { id: 'RED-4-1', color: 'RED', kind: 'NUMBER', value: 4 };
    const topCard: Card = { id: 'RED-1-1', color: 'RED', kind: 'NUMBER', value: 1 };

    const preWinState: GameState = {
      ...base,
      currentPlayerIndex: 0,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      discardPile: [topCard],
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [winningCard],
          score: 400,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [numCard, skipCard, wildCard, wd4Card], // 127 points
          score: 120,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
      ],
    };

    const won = reduce(preWinState, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'RED-4-1',
      seq: 1,
    });
    expect(won.ok).toBe(true);
    if (won.ok) {
      expect(won.state.status).toBe('MATCH_OVER');
      expect(won.state.players[0]!.score).toBe(527);
      expect(won.state.matchWinnerId).toBe('p1');
      // Seed is revealed in PlayerView only once MATCH_OVER is reached
      const viewAfter = getPlayerView(won.state, 'p1');
      expect(viewAfter.revealedSeed).toBe('score-seed');
    }
  });
});

describe('@cardclash/engine — House Rules (Stacking, 7-0 Swap, Jump-In, +4 Challenge)', () => {
  it('supports stacking +2/+2 and +4/+4 when houseRules.stacking = true', () => {
    const base = createGame({
      matchId: 'stack-test',
      seed: 'stack-seed',
      players: TEST_PLAYERS_3,
      houseRules: { stacking: true },
    });

    const redTop: Card = { id: 'RED-1-1', color: 'RED', kind: 'NUMBER', value: 1 };
    const redD2: Card = {
      id: 'RED-DRAW_TWO-1',
      color: 'RED',
      kind: 'DRAW_TWO',
      value: null,
    };
    const blueD2: Card = {
      id: 'BLUE-DRAW_TWO-1',
      color: 'BLUE',
      kind: 'DRAW_TWO',
      value: null,
    };
    const green9: Card = { id: 'GREEN-9-1', color: 'GREEN', kind: 'NUMBER', value: 9 };

    const state: GameState = {
      ...base,
      currentPlayerIndex: 0,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      discardPile: [redTop],
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [redD2, green9],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [blueD2, green9],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p3',
          name: 'Charlie',
          hand: [green9],
          score: 0,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
      ],
    };

    // p1 plays RED-DRAW_TWO -> pendingDrawCount = 2, p2 in STACK_OR_DRAW
    const step1 = reduce(state, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'RED-DRAW_TWO-1',
      seq: 1,
    });
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    expect(step1.state.pendingDrawCount).toBe(2);
    expect(step1.state.turnPhase).toBe('STACK_OR_DRAW');
    expect(step1.state.currentPlayerIndex).toBe(1);

    // p2 stacks BLUE-DRAW_TWO -> pendingDrawCount = 4, p3 in STACK_OR_DRAW
    const step2 = reduce(step1.state, {
      type: 'PLAY_CARD',
      playerId: 'p2',
      cardId: 'BLUE-DRAW_TWO-1',
      seq: 1,
    });
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    expect(step2.state.pendingDrawCount).toBe(4);
    expect(step2.state.currentPlayerIndex).toBe(2);

    // p3 cannot stack and draws all 4 cards, skipping their turn back to p1 (index 0)
    const step3 = reduce(step2.state, {
      type: 'DRAW_CARD',
      playerId: 'p3',
      seq: 1,
    });
    expect(step3.ok).toBe(true);
    if (step3.ok) {
      expect(step3.state.players[2]!.hand).toHaveLength(5);
      expect(step3.state.pendingDrawCount).toBe(0);
      expect(step3.state.currentPlayerIndex).toBe(0);
    }
  });

  it('supports 7-0 hand swap & rotation when houseRules.sevenZeroSwap = true', () => {
    const base = createGame({
      matchId: 'swap-test',
      seed: 'swap-seed',
      players: TEST_PLAYERS_3,
      houseRules: { sevenZeroSwap: true },
    });

    const red7: Card = { id: 'RED-7-1', color: 'RED', kind: 'NUMBER', value: 7 };
    const red0: Card = { id: 'RED-0-1', color: 'RED', kind: 'NUMBER', value: 0 };
    const cA: Card = { id: 'BLUE-1-1', color: 'BLUE', kind: 'NUMBER', value: 1 };
    const cB: Card = { id: 'GREEN-2-1', color: 'GREEN', kind: 'NUMBER', value: 2 };
    const cC: Card = { id: 'YELLOW-3-1', color: 'YELLOW', kind: 'NUMBER', value: 3 };

    const state7: GameState = {
      ...base,
      currentPlayerIndex: 0,
      direction: 1,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      discardPile: [{ id: 'RED-5-1', color: 'RED', kind: 'NUMBER', value: 5 }],
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [red7, cA],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [cB],
          score: 0,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p3',
          name: 'Charlie',
          hand: [red0, cC],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
      ],
    };

    // Playing 7 enters AWAITING_SWAP_TARGET
    const played7 = reduce(state7, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'RED-7-1',
      seq: 1,
    });
    expect(played7.ok).toBe(true);
    if (!played7.ok) return;
    expect(played7.state.turnPhase).toBe('AWAITING_SWAP_TARGET');

    // p1 swaps with p3
    const swapped = reduce(played7.state, {
      type: 'CHOOSE_SWAP_TARGET',
      playerId: 'p1',
      targetPlayerId: 'p3',
      seq: 2,
    });
    expect(swapped.ok).toBe(true);
    if (!swapped.ok) return;
    expect(swapped.state.players[0]!.hand.map((c) => c.id)).toEqual(['RED-0-1', 'YELLOW-3-1']);
    expect(swapped.state.players[2]!.hand.map((c) => c.id)).toEqual(['BLUE-1-1']);
  });

  it('supports Jump-In out of turn on exact card matches when houseRules.jumpIn = true', () => {
    const base = createGame({
      matchId: 'jump-test',
      seed: 'jump-seed',
      players: TEST_PLAYERS_3,
      houseRules: { jumpIn: true },
    });

    const red5Copy1: Card = { id: 'RED-5-1', color: 'RED', kind: 'NUMBER', value: 5 };
    const red5Copy2: Card = { id: 'RED-5-2', color: 'RED', kind: 'NUMBER', value: 5 };
    const blue9: Card = { id: 'BLUE-9-1', color: 'BLUE', kind: 'NUMBER', value: 9 };

    const state: GameState = {
      ...base,
      currentPlayerIndex: 0,
      direction: 1,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      discardPile: [red5Copy1],
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [blue9],
          score: 0,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [blue9],
          score: 0,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p3',
          name: 'Charlie',
          hand: [red5Copy2, blue9],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
      ],
    };

    // Although it is p1's turn, p3 jumps in with RED-5-2!
    const jumped = reduce(state, {
      type: 'PLAY_CARD',
      playerId: 'p3',
      cardId: 'RED-5-2',
      seq: 1,
    });
    expect(jumped.ok).toBe(true);
    if (jumped.ok) {
      // Turn continues from p3 (index 2) -> next player is p1 (index 0)
      expect(jumped.state.currentPlayerIndex).toBe(0);
    }
  });

  it('supports +4 Challenge (guilty bluffer draws 4; wrong challenger draws 6)', () => {
    const base = createGame({
      matchId: 'challenge-test',
      seed: 'challenge-seed',
      players: TEST_PLAYERS_2,
      houseRules: { wildDrawFourChallenge: true },
    });

    const red2: Card = { id: 'RED-2-1', color: 'RED', kind: 'NUMBER', value: 2 };
    const blue3: Card = { id: 'BLUE-3-1', color: 'BLUE', kind: 'NUMBER', value: 3 };
    const wd4: Card = {
      id: 'WILD_DRAW_FOUR-1',
      color: 'WILD',
      kind: 'WILD_DRAW_FOUR',
      value: null,
    };

    // Case 1: Guilty bluffer (p1 holds RED-2-1 while currentColor is RED)
    const guiltyState: GameState = {
      ...base,
      currentPlayerIndex: 0,
      turnPhase: 'PLAY_OR_DRAW',
      currentColor: 'RED',
      discardPile: [{ id: 'RED-9-1', color: 'RED', kind: 'NUMBER', value: 9 }],
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [wd4, red2],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        {
          id: 'p2',
          name: 'Bob',
          hand: [blue3],
          score: 0,
          calledUno: true,
          preCalledUno: false,
          connected: true,
        },
      ],
    };

    const playedBluff = reduce(guiltyState, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'WILD_DRAW_FOUR-1',
      chosenColor: 'BLUE',
      seq: 1,
    });
    expect(playedBluff.ok).toBe(true);
    if (!playedBluff.ok) return;
    expect(playedBluff.state.turnPhase).toBe('AWAITING_WD4_CHALLENGE');

    const challengedGuilty = reduce(playedBluff.state, {
      type: 'CHALLENGE_WILD_DRAW_FOUR',
      playerId: 'p2',
      seq: 1,
    });
    expect(challengedGuilty.ok).toBe(true);
    if (challengedGuilty.ok) {
      // Guilty bluffer (p1) draws 4 cards (1 + 4 = 5) and p2 keeps their turn
      expect(challengedGuilty.state.players[0]!.hand).toHaveLength(5);
      expect(challengedGuilty.state.currentPlayerIndex).toBe(1);
    }

    // Case 2: Innocent play (p1 has no RED cards) -> wrong challenger draws 6 and loses turn
    const innocentState: GameState = {
      ...guiltyState,
      players: [
        {
          id: 'p1',
          name: 'Alice',
          hand: [wd4, blue3],
          score: 0,
          calledUno: false,
          preCalledUno: false,
          connected: true,
        },
        guiltyState.players[1]!,
      ],
    };

    const playedHonest = reduce(innocentState, {
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardId: 'WILD_DRAW_FOUR-1',
      chosenColor: 'BLUE',
      seq: 1,
    });
    expect(playedHonest.ok).toBe(true);
    if (!playedHonest.ok) return;

    const challengedInnocent = reduce(playedHonest.state, {
      type: 'CHALLENGE_WILD_DRAW_FOUR',
      playerId: 'p2',
      seq: 1,
    });
    expect(challengedInnocent.ok).toBe(true);
    if (challengedInnocent.ok) {
      // Wrong challenger (p2) draws 6 cards (1 + 6 = 7) and loses turn back to p1 (index 0)
      expect(challengedInnocent.state.players[1]!.hand).toHaveLength(7);
      expect(challengedInnocent.state.currentPlayerIndex).toBe(0);
    }
  });
});

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  COLORED_SUITS,
  canPlayerPlayCard,
  createGame,
  getPlayerView,
  reduce,
  type ColoredCardColor,
  type GameAction,
  type GameState,
} from '../src/index';

function assertEngineInvariants(state: GameState): void {
  // 1. 108-card conservation invariant + uniqueness of every card ID
  const allCards = [
    ...state.drawPile,
    ...state.discardPile,
    ...state.players.flatMap((p) => p.hand),
  ];
  expect(allCards).toHaveLength(108);

  const uniqueIds = new Set(allCards.map((c) => c.id));
  expect(uniqueIds.size).toBe(108);

  // 2. Valid turn order & direction invariant
  expect(state.currentPlayerIndex).toBeGreaterThanOrEqual(0);
  expect(state.currentPlayerIndex).toBeLessThan(state.players.length);
  expect([1, -1]).toContain(state.direction);
  expect(state.discardPile.length).toBeGreaterThanOrEqual(1);

  // 3. PlayerView zero-leak invariant for every seat
  for (const viewer of state.players) {
    const view = getPlayerView(state, viewer.id);
    expect(view.viewerId).toBe(viewer.id);
    expect(view.hand).toHaveLength(viewer.hand.length);

    const viewerCardIds = new Set(viewer.hand.map((c) => c.id));
    const serializedView = JSON.stringify(view);

    // Ensure no opponent hand card ID or drawPile card ID leaks into PlayerView
    for (const opp of state.players) {
      if (opp.id === viewer.id) continue;
      for (const oppCard of opp.hand) {
        expect(viewerCardIds.has(oppCard.id)).toBe(false);
        expect(serializedView).not.toContain(`"${oppCard.id}"`);
      }
    }

    for (const drawCard of state.drawPile) {
      expect(serializedView).not.toContain(`"${drawCard.id}"`);
    }

    // Seed must never be revealed while match is not over
    if (state.status !== 'MATCH_OVER') {
      expect(view.revealedSeed).toBeNull();
      expect(serializedView).not.toContain(state.seed);
    } else {
      expect(view.revealedSeed).toBe(state.seed);
    }
  }
}

function pickNextLegalAction(
  state: GameState,
  choiceInt: number
): GameAction | null {
  if (state.status === 'MATCH_OVER') {
    return null;
  }

  const activePlayer = state.players[state.currentPlayerIndex]!;
  const nextSeq = (playerId: string) => (state.lastSeqByPlayer[playerId] ?? 0) + 1;
  const colorChoice: ColoredCardColor =
    COLORED_SUITS[Math.abs(choiceInt) % COLORED_SUITS.length]!;

  if (state.status === 'ROUND_OVER') {
    return {
      type: 'START_NEXT_ROUND',
      playerId: activePlayer.id,
      seq: nextSeq(activePlayer.id),
    };
  }

  // Occasionally exercise CALL_UNO or CATCH_UNO if someone is vulnerable
  if (state.unoVulnerablePlayerId && Math.abs(choiceInt) % 3 === 0) {
    const vulnerableId = state.unoVulnerablePlayerId;
    if (Math.abs(choiceInt) % 2 === 0) {
      return {
        type: 'CALL_UNO',
        playerId: vulnerableId,
        seq: nextSeq(vulnerableId),
      };
    }
    const catcher = state.players.find((p) => p.id !== vulnerableId)!;
    return {
      type: 'CATCH_UNO',
      playerId: catcher.id,
      targetPlayerId: vulnerableId,
      seq: nextSeq(catcher.id),
    };
  }

  if (state.turnPhase === 'AWAITING_INITIAL_WILD_COLOR') {
    return {
      type: 'CHOOSE_INITIAL_COLOR',
      playerId: activePlayer.id,
      color: colorChoice,
      seq: nextSeq(activePlayer.id),
    };
  }

  if (state.turnPhase === 'AWAITING_SWAP_TARGET') {
    const opponents = state.players.filter((p) => p.id !== activePlayer.id);
    const target = opponents[Math.abs(choiceInt) % opponents.length]!;
    return {
      type: 'CHOOSE_SWAP_TARGET',
      playerId: activePlayer.id,
      targetPlayerId: target.id,
      seq: nextSeq(activePlayer.id),
    };
  }

  if (state.turnPhase === 'AWAITING_WD4_CHALLENGE') {
    return Math.abs(choiceInt) % 2 === 0
      ? {
          type: 'ACCEPT_WILD_DRAW_FOUR',
          playerId: activePlayer.id,
          seq: nextSeq(activePlayer.id),
        }
      : {
          type: 'CHALLENGE_WILD_DRAW_FOUR',
          playerId: activePlayer.id,
          seq: nextSeq(activePlayer.id),
        };
  }

  if (state.turnPhase === 'DRAWN_PLAY_OR_PASS') {
    const drawnId = state.pendingDrawnCardId;
    if (
      drawnId &&
      Math.abs(choiceInt) % 2 === 0 &&
      canPlayerPlayCard(state, activePlayer.id, drawnId)
    ) {
      const card = activePlayer.hand.find((c) => c.id === drawnId)!;
      return {
        type: 'PLAY_CARD',
        playerId: activePlayer.id,
        cardId: card.id,
        ...(card.color === 'WILD' ? { chosenColor: colorChoice } : {}),
        seq: nextSeq(activePlayer.id),
      };
    }
    return {
      type: 'PASS_TURN',
      playerId: activePlayer.id,
      seq: nextSeq(activePlayer.id),
    };
  }

  // PLAY_OR_DRAW or STACK_OR_DRAW
  const playableCards = activePlayer.hand.filter((c) =>
    canPlayerPlayCard(state, activePlayer.id, c.id)
  );

  if (playableCards.length > 0 && Math.abs(choiceInt) % 4 !== 0) {
    const chosenCard = playableCards[Math.abs(choiceInt) % playableCards.length]!;
    return {
      type: 'PLAY_CARD',
      playerId: activePlayer.id,
      cardId: chosenCard.id,
      ...(chosenCard.color === 'WILD' ? { chosenColor: colorChoice } : {}),
      callUno: activePlayer.hand.length === 2 && Math.abs(choiceInt) % 2 === 0,
      seq: nextSeq(activePlayer.id),
    };
  }

  return {
    type: 'DRAW_CARD',
    playerId: activePlayer.id,
    seq: nextSeq(activePlayer.id),
  };
}

describe('@cardclash/engine — Property-Based Invariant Tests (fast-check)', () => {
  it('conserves all 108 unique cards, valid turn order, and leak-free PlayerViews across arbitrary action sequences and house rules', () => {
    fc.assert(
      fc.property(
        fc
          .uint8Array({ minLength: 16, maxLength: 32 })
          .map((arr) =>
            Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
          ),
        fc.integer({ min: 2, max: 6 }),
        fc.record({
          stacking: fc.boolean(),
          sevenZeroSwap: fc.boolean(),
          jumpIn: fc.boolean(),
          wildDrawFourChallenge: fc.boolean(),
        }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 15, maxLength: 80 }),
        (seedHex, playerCount, houseRules, stepChoices) => {
          const players = Array.from({ length: playerCount }, (_, idx) => ({
            id: `player_${idx + 1}`,
            name: `Player ${idx + 1}`,
          }));

          let state = createGame({
            matchId: 'prop-match',
            seed: `secret_seed_${seedHex}`,
            players,
            houseRules,
            targetScore: 250,
          });

          assertEngineInvariants(state);

          const recordedActions: GameAction[] = [];

          for (const choice of stepChoices) {
            const action = pickNextLegalAction(state, choice);
            if (!action) break;

            const result = reduce(state, action);
            expect(result.ok).toBe(true);
            if (result.ok) {
              recordedActions.push(action);
              state = result.state;
              assertEngineInvariants(state);
            }
          }

          // Verify deterministic replay from initial seed + recorded actions
          let replayState = createGame({
            matchId: 'prop-match',
            seed: `secret_seed_${seedHex}`,
            players,
            houseRules,
            targetScore: 250,
          });
          for (const act of recordedActions) {
            const step = reduce(replayState, act);
            expect(step.ok).toBe(true);
            if (step.ok) {
              replayState = step.state;
            }
          }
          expect(replayState).toEqual(state);
        }
      ),
      { numRuns: 50 }
    );
  });
});

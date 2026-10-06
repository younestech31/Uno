import { calculateHandPoints, COLORED_SUITS, createStandardDeck } from './deck';
import { createPrngState, fisherYatesShuffle } from './prng';
import {
   getNextPlayerIndex,
  hasCardOfCurrentColor,
  isExactJumpInMatch,
  isPlayable,
} from './rules';
import {
  type Card,
  type ColoredCardColor,
  DEFAULT_HOUSE_RULES,
  type EngineError,
  type EngineErrorCode,
  type EngineResult,
  type GameAction,
  type GameConfig,
  type GameEvent,
  type GameState,
  type HouseRules,
  type PlayDirection,
  type PlayerState,
  type PrngState,
  type TurnPhase,
} from './types';

function fail(code: EngineErrorCode, message: string): EngineResult {
  const error: EngineError = { code, message };
  return { ok: false, error };
}

function isValidColoredSuit(color: unknown): color is ColoredCardColor {
  return (
    typeof color === 'string' &&
    (COLORED_SUITS as readonly string[]).includes(color)
  );
}

interface DrawResult {
  readonly drawn: Card[];
  readonly drawPile: Card[];
  readonly discardPile: Card[];
  readonly prngState: PrngState;
  readonly reshuffleEvents: GameEvent[];
}

/**
 * Pure helper that draws up to `count` cards from `drawPile`.
 * If `drawPile` becomes empty, reshuffles all cards from `discardPile`
 * except the top card using the seeded Fisher-Yates PRNG.
 */
function drawFromDeck(
  drawPileInput: readonly Card[],
  discardPileInput: readonly Card[],
  prngStateInput: PrngState,
  count: number
): DrawResult {
  let drawPile = drawPileInput.slice();
  let discardPile = discardPileInput.slice();
  let prngState = prngStateInput;
  const drawn: Card[] = [];
  const reshuffleEvents: GameEvent[] = [];

  for (let i = 0; i < count; i++) {
    if (drawPile.length === 0) {
      if (discardPile.length <= 1) {
        // No more cards available to reshuffle; conserve existing cards
        break;
      }
      const topCard = discardPile[discardPile.length - 1]!;
      const underCards = discardPile.slice(0, -1);
      const shuffled = fisherYatesShuffle(underCards, prngState);
      drawPile = shuffled.shuffled;
      prngState = shuffled.prngState;
      discardPile = [topCard];
      reshuffleEvents.push({
        type: 'DECK_RESHUFFLED',
        newDrawPileCount: drawPile.length,
      });
    }

    const nextCard = drawPile.shift();
    if (!nextCard) {
      break;
    }
    drawn.push(nextCard);
  }

  return {
    drawn,
    drawPile,
    discardPile,
    prngState,
    reshuffleEvents,
  };
}

interface DealRoundOutput {
  readonly players: PlayerState[];
  readonly drawPile: Card[];
  readonly discardPile: Card[];
  readonly prngState: PrngState;
  readonly currentPlayerIndex: number;
  readonly direction: PlayDirection;
  readonly turnPhase: TurnPhase;
  readonly currentColor: ColoredCardColor | null;
  readonly events: GameEvent[];
}

/**
 * Deals a fresh 108-card round and applies all first-card flip rules:
 * - Wild Draw Four: return to deck, reshuffle, and reflip
 * - Wild: first player (seat 0) picks color (AWAITING_INITIAL_WILD_COLOR)
 * - Skip: first player (seat 0) is skipped -> seat 1 acts
 * - Draw Two: first player (seat 0) draws 2 cards and is skipped -> seat 1 acts
 * - Reverse: flips direction to -1; with 2 players acts as Skip (seat 1 acts),
 *   with 3+ players moves to seat N-1.
 */
function dealRound(
  basePlayers: readonly Pick<PlayerState, 'id' | 'name' | 'score' | 'connected'>[],
  initialHandSize: number,
  roundNumber: number,
  prngStateInput: PrngState
): DealRoundOutput {
  const fullDeck = createStandardDeck();
  const initialShuffle = fisherYatesShuffle(fullDeck, prngStateInput);
  let drawPile = initialShuffle.shuffled;
  let prngState = initialShuffle.prngState;

  const hands: Card[][] = basePlayers.map(() => []);
  for (let cardIndex = 0; cardIndex < initialHandSize; cardIndex++) {
    for (let seat = 0; seat < basePlayers.length; seat++) {
      const card = drawPile.shift();
      if (!card) {
        throw new Error('Deck exhausted during initial deal');
      }
      hands[seat]!.push(card);
    }
  }

  // Flip first card; if WILD_DRAW_FOUR, return to drawPile, reshuffle, and reflip
  let firstCard = drawPile.shift()!;
  while (firstCard.kind === 'WILD_DRAW_FOUR') {
    drawPile.push(firstCard);
    const reshuffled = fisherYatesShuffle(drawPile, prngState);
    drawPile = reshuffled.shuffled;
    prngState = reshuffled.prngState;
    firstCard = drawPile.shift()!;
  }

  let discardPile: Card[] = [firstCard];
  let direction: PlayDirection = 1;
  let currentPlayerIndex = 0;
  let turnPhase: TurnPhase = 'PLAY_OR_DRAW';
  let currentColor: ColoredCardColor | null =
    firstCard.color === 'WILD' ? null : firstCard.color;
  const events: GameEvent[] = [];

  const players: PlayerState[] = basePlayers.map((p, idx) => ({
    id: p.id,
    name: p.name,
    hand: hands[idx]!,
    score: p.score,
    calledUno: false,
    preCalledUno: false,
    connected: p.connected,
  }));

  const playerCount = players.length;

  if (firstCard.kind === 'WILD') {
    currentColor = null;
    turnPhase = 'AWAITING_INITIAL_WILD_COLOR';
    currentPlayerIndex = 0;
  } else if (firstCard.kind === 'SKIP') {
    const skippedPlayer = players[0]!;
    events.push({
      type: 'TURN_SKIPPED',
      skippedPlayerId: skippedPlayer.id,
      reason: 'INITIAL_FLIP',
    });
    currentPlayerIndex = getNextPlayerIndex(0, direction, playerCount, 1);
  } else if (firstCard.kind === 'DRAW_TWO') {
    const firstPlayer = players[0]!;
    const drawRes = drawFromDeck(drawPile, discardPile, prngState, 2);
    drawPile = drawRes.drawPile;
    discardPile = drawRes.discardPile;
    prngState = drawRes.prngState;
    events.push(...drawRes.reshuffleEvents);

    players[0] = {
      ...firstPlayer,
      hand: [...firstPlayer.hand, ...drawRes.drawn],
    };
    events.push({
      type: 'CARDS_DRAWN',
      playerId: firstPlayer.id,
      count: drawRes.drawn.length,
      reason: 'INITIAL_FLIP',
    });
    events.push({
      type: 'TURN_SKIPPED',
      skippedPlayerId: firstPlayer.id,
      reason: 'INITIAL_FLIP',
    });
    currentPlayerIndex = getNextPlayerIndex(0, direction, playerCount, 1);
  } else if (firstCard.kind === 'REVERSE') {
    direction = -1;
    events.push({
      type: 'DIRECTION_REVERSED',
      direction,
    });
    if (playerCount === 2) {
      // Reverse acts as Skip with 2 players: seat 0 is skipped, seat 1 acts
      events.push({
        type: 'TURN_SKIPPED',
        skippedPlayerId: players[0]!.id,
        reason: 'REVERSE_TWO_PLAYER',
      });
      currentPlayerIndex = 1;
    } else {
      currentPlayerIndex = getNextPlayerIndex(0, direction, playerCount, 1);
    }
  }

  events.unshift({
    type: 'ROUND_STARTED',
    roundNumber,
    firstCard,
    startingPlayerId: players[currentPlayerIndex]!.id,
    direction,
  });

  return {
    players,
    drawPile,
    discardPile,
    prngState,
    currentPlayerIndex,
    direction,
    turnPhase,
    currentColor,
    events,
  };
}

/**
 * Creates a new deterministic GameState from `config`.
 */
export function createGame(config: GameConfig): GameState {
  const maxPlayers = config.maxPlayers ?? 10;
  const initialHandSize = config.initialHandSize ?? 7;
  const targetScore = config.targetScore ?? 500;

  if (!config.matchId || config.matchId.trim().length === 0) {
    throw new Error('matchId is required');
  }
  if (!config.seed || config.seed.trim().length === 0) {
    throw new Error('seed is required');
  }
  if (config.players.length < 2 || config.players.length > maxPlayers) {
    throw new Error(
      `Player count must be between 2 and ${maxPlayers} (received ${config.players.length})`
    );
  }
  if (initialHandSize < 1 || initialHandSize * config.players.length >= 100) {
    throw new Error('Invalid initialHandSize for 108-card deck');
  }

  const seenIds = new Set<string>();
  for (const p of config.players) {
    if (!p.id || p.id.trim().length === 0) {
      throw new Error('Every player must have a non-empty id');
    }
    if (seenIds.has(p.id)) {
      throw new Error(`Duplicate player id: ${p.id}`);
    }
    seenIds.add(p.id);
  }

  const houseRules: HouseRules = {
    ...DEFAULT_HOUSE_RULES,
    ...config.houseRules,
  };

  const initialPrngState = createPrngState(config.seed);
  const basePlayers = config.players.map((p) => ({
    id: p.id,
    name: p.name,
    score: 0,
    connected: true,
  }));

  const dealt = dealRound(basePlayers, initialHandSize, 1, initialPrngState);

  const lastSeqByPlayer: Record<string, number> = {};
  for (const p of config.players) {
    lastSeqByPlayer[p.id] = 0;
  }

  return {
    matchId: config.matchId,
    seed: config.seed,
    prngState: dealt.prngState,
    status: 'IN_PROGRESS',
    roundNumber: 1,
    players: dealt.players,
    currentPlayerIndex: dealt.currentPlayerIndex,
    direction: dealt.direction,
    turnPhase: dealt.turnPhase,
    drawPile: dealt.drawPile,
    discardPile: dealt.discardPile,
    currentColor: dealt.currentColor,
    pendingDrawnCardId: null,
    pendingDrawCount: 0,
    pendingDrawKind: null,
    unoVulnerablePlayerId: null,
    wd4ChallengeState: null,
    lastSeqByPlayer,
    houseRules,
    targetScore,
    initialHandSize,
    roundWinnerId: null,
    matchWinnerId: null,
  };
}

/**
 * Pure state machine reducer: reduce(state, action) -> EngineResult.
 * Never mutates `state`; performs zero I/O, Date.now(), or Math.random().
 */
export function reduce(state: GameState, action: GameAction): EngineResult {
  const playerIndex = state.players.findIndex((p) => p.id === action.playerId);
  if (playerIndex === -1) {
    return fail('UNKNOWN_PLAYER', `Player "${action.playerId}" is not in this match`);
  }

  const lastSeq = state.lastSeqByPlayer[action.playerId] ?? 0;
  if (!Number.isInteger(action.seq) || action.seq <= lastSeq) {
    return fail(
      'STALE_SEQUENCE',
      `Action seq (${action.seq}) must be an integer greater than lastSeq (${lastSeq})`
    );
  }

  const updatedSeqMap: Record<string, number> = {
    ...state.lastSeqByPlayer,
    [action.playerId]: action.seq,
  };

  // Handle START_NEXT_ROUND when status === 'ROUND_OVER'
  if (action.type === 'START_NEXT_ROUND') {
    if (state.status !== 'ROUND_OVER') {
      return fail(
        'ROUND_NOT_OVER',
        'Cannot start next round unless current round is over'
      );
    }
    const nextRoundNumber = state.roundNumber + 1;
    const dealt = dealRound(
      state.players,
      state.initialHandSize,
      nextRoundNumber,
      state.prngState
    );

    return {
      ok: true,
      state: {
        ...state,
        prngState: dealt.prngState,
        status: 'IN_PROGRESS',
        roundNumber: nextRoundNumber,
        players: dealt.players,
        currentPlayerIndex: dealt.currentPlayerIndex,
        direction: dealt.direction,
        turnPhase: dealt.turnPhase,
        drawPile: dealt.drawPile,
        discardPile: dealt.discardPile,
        currentColor: dealt.currentColor,
        pendingDrawnCardId: null,
        pendingDrawCount: 0,
        pendingDrawKind: null,
        unoVulnerablePlayerId: null,
        wd4ChallengeState: null,
        lastSeqByPlayer: updatedSeqMap,
        roundWinnerId: null,
      },
      events: dealt.events,
    };
  }

  if (state.status !== 'IN_PROGRESS') {
    return fail(
      'GAME_NOT_IN_PROGRESS',
      `Cannot perform ${action.type} when game status is ${state.status}`
    );
  }

  const actingPlayer = state.players[playerIndex]!;
  const playerCount = state.players.length;

  // 1. Handle CALL_UNO
  if (action.type === 'CALL_UNO') {
    // Case A: Player is currently vulnerable at 1 card after playing
    if (state.unoVulnerablePlayerId === action.playerId && actingPlayer.hand.length === 1) {
      const updatedPlayers = state.players.map((p, idx) =>
        idx === playerIndex ? { ...p, calledUno: true, preCalledUno: false } : p
      );
      return {
        ok: true,
        state: {
          ...state,
          players: updatedPlayers,
          unoVulnerablePlayerId: null,
          lastSeqByPlayer: updatedSeqMap,
        },
        events: [{ type: 'UNO_CALLED', playerId: action.playerId }],
      };
    }

    // Case B: Player has 2 cards on their turn (or can jump in) and pre-declares UNO before playing down to 1
    if (
      actingPlayer.hand.length === 2 &&
      !actingPlayer.preCalledUno &&
      (playerIndex === state.currentPlayerIndex || state.houseRules.jumpIn)
    ) {
      const updatedPlayers = state.players.map((p, idx) =>
        idx === playerIndex ? { ...p, preCalledUno: true } : p
      );
      return {
        ok: true,
        state: {
          ...state,
          players: updatedPlayers,
          lastSeqByPlayer: updatedSeqMap,
        },
        events: [{ type: 'UNO_CALLED', playerId: action.playerId }],
      };
    }

    return fail(
      'INVALID_UNO_CALL',
      'Can only call UNO when holding 1 card (uncalled) or 2 cards prior to playing'
    );
  }

  // 2. Handle CATCH_UNO
  if (action.type === 'CATCH_UNO') {
    const vulnerableId = state.unoVulnerablePlayerId;
    if (!vulnerableId) {
      return fail('INVALID_CATCH', 'No player is currently vulnerable to being caught for UNO');
    }
    if (action.targetPlayerId && action.targetPlayerId !== vulnerableId) {
      return fail(
        'INVALID_CATCH',
        `Player "${action.targetPlayerId}" is not vulnerable to UNO catch`
      );
    }
    if (action.playerId === vulnerableId) {
      return fail('INVALID_CATCH', 'A player cannot catch themselves for UNO');
    }

    const vulnerableIndex = state.players.findIndex((p) => p.id === vulnerableId);
    const vulnerablePlayer = state.players[vulnerableIndex]!;
    if (vulnerablePlayer.calledUno || vulnerablePlayer.hand.length !== 1) {
      return fail('INVALID_CATCH', 'Target player is not vulnerable to UNO penalty');
    }

    const drawRes = drawFromDeck(state.drawPile, state.discardPile, state.prngState, 2);
    const updatedPlayers = state.players.map((p, idx) =>
      idx === vulnerableIndex
        ? {
            ...p,
            hand: [...p.hand, ...drawRes.drawn],
            calledUno: false,
            preCalledUno: false,
          }
        : p
    );

    const events: GameEvent[] = [
      ...drawRes.reshuffleEvents,
      {
        type: 'UNO_CAUGHT',
        catcherId: action.playerId,
        caughtId: vulnerableId,
        penaltyCount: drawRes.drawn.length,
      },
      {
        type: 'CARDS_DRAWN',
        playerId: vulnerableId,
        count: drawRes.drawn.length,
        reason: 'UNO_PENALTY',
      },
    ];

    return {
      ok: true,
      state: {
        ...state,
        prngState: drawRes.prngState,
        drawPile: drawRes.drawPile,
        discardPile: drawRes.discardPile,
        players: updatedPlayers,
        unoVulnerablePlayerId: null,
        lastSeqByPlayer: updatedSeqMap,
      },
      events,
    };
  }

  // 3. Handle CHOOSE_INITIAL_COLOR (when first card flipped was a Wild)
  if (action.type === 'CHOOSE_INITIAL_COLOR') {
    if (state.turnPhase !== 'AWAITING_INITIAL_WILD_COLOR') {
      return fail(
        'INVALID_PHASE_ACTION',
        'CHOOSE_INITIAL_COLOR is only valid when awaiting initial wild color'
      );
    }
    if (playerIndex !== state.currentPlayerIndex) {
      return fail('NOT_YOUR_TURN', 'Only the starting player may choose the initial wild color');
    }
    if (!isValidColoredSuit(action.color)) {
      return fail('MISSING_WILD_COLOR', 'Must specify a valid color (RED, YELLOW, GREEN, BLUE)');
    }

    return {
      ok: true,
      state: {
        ...state,
        currentColor: action.color,
        turnPhase: 'PLAY_OR_DRAW',
        lastSeqByPlayer: updatedSeqMap,
      },
      events: [
        {
          type: 'INITIAL_COLOR_CHOSEN',
          playerId: action.playerId,
          color: action.color,
        },
      ],
    };
  }

  // 4. Handle CHOOSE_SWAP_TARGET (7-0 house rule after playing a 7)
  if (action.type === 'CHOOSE_SWAP_TARGET') {
    if (state.turnPhase !== 'AWAITING_SWAP_TARGET') {
      return fail(
        'INVALID_PHASE_ACTION',
        'CHOOSE_SWAP_TARGET is only valid immediately after playing a 7 with sevenZeroSwap enabled'
      );
    }
    if (playerIndex !== state.currentPlayerIndex) {
      return fail('NOT_YOUR_TURN', 'Only the active player may choose the swap target');
    }
    if (action.targetPlayerId === action.playerId) {
      return fail('INVALID_SWAP_TARGET', 'Cannot swap hands with yourself');
    }
    const targetIndex = state.players.findIndex((p) => p.id === action.targetPlayerId);
    if (targetIndex === -1) {
      return fail('INVALID_SWAP_TARGET', `Target player "${action.targetPlayerId}" not found`);
    }

    const sourcePlayer = state.players[playerIndex]!;
    const targetPlayer = state.players[targetIndex]!;
    const sourceNewHand = targetPlayer.hand.slice();
    const targetNewHand = sourcePlayer.hand.slice();

    const updatedPlayers = state.players.map((p, idx) => {
      if (idx === playerIndex) {
        return {
          ...p,
          hand: sourceNewHand,
          calledUno: sourceNewHand.length === 1 ? targetPlayer.calledUno : false,
          preCalledUno: false,
        };
      }
      if (idx === targetIndex) {
        return {
          ...p,
          hand: targetNewHand,
          calledUno: targetNewHand.length === 1 ? sourcePlayer.calledUno : false,
          preCalledUno: false,
        };
      }
      return p;
    });

    // Determine if either swapped player now has 1 card without UNO called
    let nextUnoVulnerable: string | null = null;
    if (updatedPlayers[playerIndex]!.hand.length === 1 && !updatedPlayers[playerIndex]!.calledUno) {
      nextUnoVulnerable = updatedPlayers[playerIndex]!.id;
    } else if (
      updatedPlayers[targetIndex]!.hand.length === 1 &&
      !updatedPlayers[targetIndex]!.calledUno
    ) {
      nextUnoVulnerable = updatedPlayers[targetIndex]!.id;
    }

    const nextPlayerIndex = getNextPlayerIndex(
      state.currentPlayerIndex,
      state.direction,
      playerCount,
      1
    );

    return {
      ok: true,
      state: {
        ...state,
        players: updatedPlayers,
        currentPlayerIndex: nextPlayerIndex,
        turnPhase: 'PLAY_OR_DRAW',
        unoVulnerablePlayerId: nextUnoVulnerable,
        lastSeqByPlayer: updatedSeqMap,
      },
      events: [
        {
          type: 'HANDS_SWAPPED',
          mode: 'SEVEN_TARGET',
          sourcePlayerId: action.playerId,
          targetPlayerId: action.targetPlayerId,
        },
      ],
    };
  }

  // 5. Handle Wild Draw Four Challenge / Acceptance (wildDrawFourChallenge house rule)
  if (
    action.type === 'ACCEPT_WILD_DRAW_FOUR' ||
    action.type === 'CHALLENGE_WILD_DRAW_FOUR'
  ) {
    if (state.turnPhase !== 'AWAITING_WD4_CHALLENGE' || !state.wd4ChallengeState) {
      return fail(
        'INVALID_PHASE_ACTION',
        `${action.type} is only valid when awaiting a Wild Draw Four challenge decision`
      );
    }
    if (playerIndex !== state.currentPlayerIndex) {
      return fail('NOT_YOUR_TURN', 'Only the targeted player may accept or challenge the +4');
    }

    const challenge = state.wd4ChallengeState;
    const events: GameEvent[] = [];

    if (action.type === 'ACCEPT_WILD_DRAW_FOUR') {
      const drawRes = drawFromDeck(state.drawPile, state.discardPile, state.prngState, 4);
      events.push(...drawRes.reshuffleEvents);

      const updatedPlayers = state.players.map((p, idx) =>
        idx === playerIndex
          ? {
              ...p,
              hand: [...p.hand, ...drawRes.drawn],
              calledUno: false,
              preCalledUno: false,
            }
          : p
      );

      events.push({
        type: 'CARDS_DRAWN',
        playerId: action.playerId,
        count: drawRes.drawn.length,
        reason: 'WILD_DRAW_FOUR',
      });
      events.push({
        type: 'TURN_SKIPPED',
        skippedPlayerId: action.playerId,
        reason: 'DRAW_PENALTY',
      });

      const nextPlayerIndex = getNextPlayerIndex(
        state.currentPlayerIndex,
        state.direction,
        playerCount,
        1
      );

      return {
        ok: true,
        state: {
          ...state,
          prngState: drawRes.prngState,
          drawPile: drawRes.drawPile,
          discardPile: drawRes.discardPile,
          players: updatedPlayers,
          currentPlayerIndex: nextPlayerIndex,
          turnPhase: 'PLAY_OR_DRAW',
          unoVulnerablePlayerId: null,
          wd4ChallengeState: null,
          lastSeqByPlayer: updatedSeqMap,
        },
        events,
      };
    }

    // CHALLENGE_WILD_DRAW_FOUR:
    // Caught bluffer draws 4 and challenger keeps turn; wrong challenger draws 6 and loses turn
    if (challenge.wasGuilty) {
      const blufferIndex = state.players.findIndex((p) => p.id === challenge.blufferPlayerId);
      const drawRes = drawFromDeck(state.drawPile, state.discardPile, state.prngState, 4);
      events.push(...drawRes.reshuffleEvents);

      const updatedPlayers = state.players.map((p, idx) =>
        idx === blufferIndex
          ? {
              ...p,
              hand: [...p.hand, ...drawRes.drawn],
              calledUno: false,
              preCalledUno: false,
            }
          : p
      );

      events.push({
        type: 'WD4_CHALLENGE_RESOLVED',
        challengerId: action.playerId,
        blufferId: challenge.blufferPlayerId,
        wasGuilty: true,
        penalizedPlayerId: challenge.blufferPlayerId,
        penaltyCount: drawRes.drawn.length,
      });
      events.push({
        type: 'CARDS_DRAWN',
        playerId: challenge.blufferPlayerId,
        count: drawRes.drawn.length,
        reason: 'CHALLENGE_PENALTY',
      });

      return {
        ok: true,
        state: {
          ...state,
          prngState: drawRes.prngState,
          drawPile: drawRes.drawPile,
          discardPile: drawRes.discardPile,
          players: updatedPlayers,
          // Challenger keeps their turn!
          currentPlayerIndex: state.currentPlayerIndex,
          turnPhase: 'PLAY_OR_DRAW',
          unoVulnerablePlayerId: null,
          wd4ChallengeState: null,
          lastSeqByPlayer: updatedSeqMap,
        },
        events,
      };
    } else {
      // Wrong challenger draws 6 and loses turn
      const drawRes = drawFromDeck(state.drawPile, state.discardPile, state.prngState, 6);
      events.push(...drawRes.reshuffleEvents);

      const updatedPlayers = state.players.map((p, idx) =>
        idx === playerIndex
          ? {
              ...p,
              hand: [...p.hand, ...drawRes.drawn],
              calledUno: false,
              preCalledUno: false,
            }
          : p
      );

      events.push({
        type: 'WD4_CHALLENGE_RESOLVED',
        challengerId: action.playerId,
        blufferId: challenge.blufferPlayerId,
        wasGuilty: false,
        penalizedPlayerId: action.playerId,
        penaltyCount: drawRes.drawn.length,
      });
      events.push({
        type: 'CARDS_DRAWN',
        playerId: action.playerId,
        count: drawRes.drawn.length,
        reason: 'CHALLENGE_PENALTY',
      });
      events.push({
        type: 'TURN_SKIPPED',
        skippedPlayerId: action.playerId,
        reason: 'DRAW_PENALTY',
      });

      const nextPlayerIndex = getNextPlayerIndex(
        state.currentPlayerIndex,
        state.direction,
        playerCount,
        1
      );

      return {
        ok: true,
        state: {
          ...state,
          prngState: drawRes.prngState,
          drawPile: drawRes.drawPile,
          discardPile: drawRes.discardPile,
          players: updatedPlayers,
          currentPlayerIndex: nextPlayerIndex,
          turnPhase: 'PLAY_OR_DRAW',
          unoVulnerablePlayerId: null,
          wd4ChallengeState: null,
          lastSeqByPlayer: updatedSeqMap,
        },
        events,
      };
    }
  }

  // 6. Handle DRAW_CARD
  if (action.type === 'DRAW_CARD') {
    if (playerIndex !== state.currentPlayerIndex) {
      return fail('NOT_YOUR_TURN', 'It is not your turn to draw');
    }
    if (state.turnPhase !== 'PLAY_OR_DRAW' && state.turnPhase !== 'STACK_OR_DRAW') {
      return fail(
        'INVALID_PHASE_ACTION',
        `Cannot draw a card during ${state.turnPhase} phase`
      );
    }

    // If stacking penalty is active, player draws the accumulated stack and loses turn
    if (state.turnPhase === 'STACK_OR_DRAW' && state.pendingDrawCount > 0) {
      const penaltyCount = state.pendingDrawCount;
      const drawReason =
        state.pendingDrawKind === 'WILD_DRAW_FOUR' ? 'WILD_DRAW_FOUR' : 'DRAW_TWO';
      const drawRes = drawFromDeck(
        state.drawPile,
        state.discardPile,
        state.prngState,
        penaltyCount
      );

      const updatedPlayers = state.players.map((p, idx) =>
        idx === playerIndex
          ? {
              ...p,
              hand: [...p.hand, ...drawRes.drawn],
              calledUno: false,
              preCalledUno: false,
            }
          : p
      );

      const nextPlayerIndex = getNextPlayerIndex(
        state.currentPlayerIndex,
        state.direction,
        playerCount,
        1
      );

      return {
        ok: true,
        state: {
          ...state,
          prngState: drawRes.prngState,
          drawPile: drawRes.drawPile,
          discardPile: drawRes.discardPile,
          players: updatedPlayers,
          currentPlayerIndex: nextPlayerIndex,
          turnPhase: 'PLAY_OR_DRAW',
          pendingDrawnCardId: null,
          pendingDrawCount: 0,
          pendingDrawKind: null,
          unoVulnerablePlayerId: null,
          lastSeqByPlayer: updatedSeqMap,
        },
        events: [
          ...drawRes.reshuffleEvents,
          {
            type: 'CARDS_DRAWN',
            playerId: action.playerId,
            count: drawRes.drawn.length,
            reason: drawReason,
          },
          {
            type: 'TURN_SKIPPED',
            skippedPlayerId: action.playerId,
            reason: 'DRAW_PENALTY',
          },
        ],
      };
    }

    // Standard 1-card turn draw: draw 1; may play it if legal, else pass
    const drawRes = drawFromDeck(state.drawPile, state.discardPile, state.prngState, 1);
    const drawnCard = drawRes.drawn[0] ?? null;

    const updatedPlayers = state.players.map((p, idx) =>
      idx === playerIndex
        ? {
            ...p,
            hand: [...p.hand, ...drawRes.drawn],
            calledUno: false,
            preCalledUno: false,
          }
        : p
    );

    return {
      ok: true,
      state: {
        ...state,
        prngState: drawRes.prngState,
        drawPile: drawRes.drawPile,
        discardPile: drawRes.discardPile,
        players: updatedPlayers,
        turnPhase: 'DRAWN_PLAY_OR_PASS',
        pendingDrawnCardId: drawnCard ? drawnCard.id : null,
        // Previous player's UNO vulnerability expires once the next player acts
        unoVulnerablePlayerId: null,
        lastSeqByPlayer: updatedSeqMap,
      },
      events: [
        ...drawRes.reshuffleEvents,
        {
          type: 'CARDS_DRAWN',
          playerId: action.playerId,
          count: drawRes.drawn.length,
          reason: 'TURN_DRAW',
        },
      ],
    };
  }

  // 7. Handle PASS_TURN
  if (action.type === 'PASS_TURN') {
    if (playerIndex !== state.currentPlayerIndex) {
      return fail('NOT_YOUR_TURN', 'It is not your turn to pass');
    }
    if (state.turnPhase !== 'DRAWN_PLAY_OR_PASS') {
      return fail(
        'INVALID_PHASE_ACTION',
        'You must draw a card before passing your turn'
      );
    }

    const nextPlayerIndex = getNextPlayerIndex(
      state.currentPlayerIndex,
      state.direction,
      playerCount,
      1
    );

    return {
      ok: true,
      state: {
        ...state,
        currentPlayerIndex: nextPlayerIndex,
        turnPhase: 'PLAY_OR_DRAW',
        pendingDrawnCardId: null,
        unoVulnerablePlayerId: null,
        lastSeqByPlayer: updatedSeqMap,
      },
      events: [{ type: 'TURN_PASSED', playerId: action.playerId }],
    };
  }

  // 8. Handle PLAY_CARD
  if (action.type === 'PLAY_CARD') {
    if (
      state.turnPhase !== 'PLAY_OR_DRAW' &&
      state.turnPhase !== 'DRAWN_PLAY_OR_PASS' &&
      state.turnPhase !== 'STACK_OR_DRAW'
    ) {
      return fail(
        'INVALID_PHASE_ACTION',
        `Cannot play a card during ${state.turnPhase} phase`
      );
    }

    const cardInHand = actingPlayer.hand.find((c) => c.id === action.cardId);
    if (!cardInHand) {
      return fail('CARD_NOT_IN_HAND', `Card "${action.cardId}" is not in your hand`);
    }

    const topCard = state.discardPile[state.discardPile.length - 1]!;
    const isCurrentTurn = playerIndex === state.currentPlayerIndex;
    let jumpedIn = false;

    if (!isCurrentTurn) {
      if (
        state.houseRules.jumpIn &&
        state.turnPhase === 'PLAY_OR_DRAW' &&
        state.pendingDrawCount === 0 &&
        isExactJumpInMatch(cardInHand, topCard)
      ) {
        jumpedIn = true;
      } else {
        return fail('NOT_YOUR_TURN', 'It is not your turn to play');
      }
    }

    if (
      state.turnPhase === 'DRAWN_PLAY_OR_PASS' &&
      cardInHand.id !== state.pendingDrawnCardId
    ) {
      return fail(
        'MUST_PLAY_DRAWN_CARD',
        'After drawing a card, you may only play the drawn card or pass'
      );
    }

    // Validate Wild color selection
    if (cardInHand.kind === 'WILD' || cardInHand.kind === 'WILD_DRAW_FOUR') {
      if (!isValidColoredSuit(action.chosenColor)) {
        return fail(
          'MISSING_WILD_COLOR',
          'Playing a Wild card requires choosing RED, YELLOW, GREEN, or BLUE'
        );
      }
    } else if (action.chosenColor !== undefined) {
      return fail(
        'UNEXPECTED_WILD_COLOR',
        'chosenColor may only be specified when playing a Wild card'
      );
    }

    // Specific check for Wild Draw Four restriction when challenge rule is OFF
    const hadCardOfPreviousColor = hasCardOfCurrentColor(
      actingPlayer.hand,
      state.currentColor,
      cardInHand.id
    );

    if (
      cardInHand.kind === 'WILD_DRAW_FOUR' &&
      !state.houseRules.wildDrawFourChallenge &&
      state.turnPhase !== 'STACK_OR_DRAW' &&
      hadCardOfPreviousColor
    ) {
      return fail(
        'ILLEGAL_WILD_DRAW_FOUR',
        'Wild Draw Four can only be played when your hand has no cards of the current color'
      );
    }

    if (
      !jumpedIn &&
      !isPlayable(cardInHand, {
        topCard,
        currentColor: state.currentColor,
        hand: actingPlayer.hand,
        houseRules: state.houseRules,
        turnPhase: state.turnPhase,
        pendingDrawnCardId: state.pendingDrawnCardId,
        pendingDrawCount: state.pendingDrawCount,
        pendingDrawKind: state.pendingDrawKind,
      })
    ) {
      return fail(
        'ILLEGAL_PLAY',
        `Card "${cardInHand.id}" cannot be legally played on "${topCard.id}" (active color: ${state.currentColor ?? 'NONE'})`
      );
    }

    const remainingHand = actingPlayer.hand.filter((c) => c.id !== cardInHand.id);
    const nextColor: ColoredCardColor =
      cardInHand.color === 'WILD' ? action.chosenColor! : cardInHand.color;
    let nextDiscardPile: Card[] = [...state.discardPile, cardInHand];
    let nextDrawPile: Card[] = state.drawPile.slice();
    let nextPrngState = state.prngState;
    const events: GameEvent[] = [
      {
        type: 'CARD_PLAYED',
        playerId: action.playerId,
        card: cardInHand,
        chosenColor: cardInHand.color === 'WILD' ? action.chosenColor! : null,
        jumpedIn,
      },
    ];

    // Evaluate UNO state for the acting player
    let playerCalledUno = false;
    let nextUnoVulnerableId: string | null = null;

    if (remainingHand.length === 1) {
      if (action.callUno === true || actingPlayer.preCalledUno) {
        playerCalledUno = true;
        if (action.callUno === true && !actingPlayer.preCalledUno) {
          events.push({ type: 'UNO_CALLED', playerId: action.playerId });
        }
      } else {
        playerCalledUno = false;
        nextUnoVulnerableId = action.playerId;
      }
    }

    let updatedPlayers: PlayerState[] = state.players.map((p, idx) =>
      idx === playerIndex
        ? {
            ...p,
            hand: remainingHand,
            calledUno: playerCalledUno,
            preCalledUno: false,
          }
        : { ...p, preCalledUno: false }
    );

    // Check if the player emptied their hand to win the round
    if (remainingHand.length === 0) {
      // If the winning card is a Draw Two or Wild Draw Four (or closes an active stack),
      // opponent hands are scored for the round winner.
      let pointsEarned = 0;
      for (let i = 0; i < updatedPlayers.length; i++) {
        if (i !== playerIndex) {
          pointsEarned += calculateHandPoints(updatedPlayers[i]!.hand);
        }
      }

      const newWinnerScore = actingPlayer.score + pointsEarned;
      updatedPlayers = updatedPlayers.map((p, idx) =>
        idx === playerIndex ? { ...p, score: newWinnerScore } : p
      );

      events.push({
        type: 'ROUND_ENDED',
        roundNumber: state.roundNumber,
        winnerId: action.playerId,
        pointsEarned,
        newScore: newWinnerScore,
      });

      const isMatchOver = newWinnerScore >= state.targetScore;
      if (isMatchOver) {
        const finalScores: Record<string, number> = {};
        for (const p of updatedPlayers) {
          finalScores[p.id] = p.score;
        }
        events.push({
          type: 'MATCH_ENDED',
          winnerId: action.playerId,
          finalScores,
          seed: state.seed,
        });
      }

      return {
        ok: true,
        state: {
          ...state,
          prngState: nextPrngState,
          status: isMatchOver ? 'MATCH_OVER' : 'ROUND_OVER',
          players: updatedPlayers,
          currentPlayerIndex: playerIndex,
          turnPhase: 'PLAY_OR_DRAW',
          drawPile: nextDrawPile,
          discardPile: nextDiscardPile,
          currentColor: nextColor,
          pendingDrawnCardId: null,
          pendingDrawCount: 0,
          pendingDrawKind: null,
          unoVulnerablePlayerId: null,
          wd4ChallengeState: null,
          lastSeqByPlayer: updatedSeqMap,
          roundWinnerId: action.playerId,
          matchWinnerId: isMatchOver ? action.playerId : null,
        },
        events,
      };
    }

    // Resolve card effects when round continues
    let nextDirection: PlayDirection = state.direction;
    let nextPlayerIndex = getNextPlayerIndex(playerIndex, nextDirection, playerCount, 1);
    let nextTurnPhase: TurnPhase = 'PLAY_OR_DRAW';
    let nextPendingDrawCount = state.pendingDrawCount;
    let nextPendingDrawKind = state.pendingDrawKind;
    let nextWd4ChallengeState = null;

    if (cardInHand.kind === 'NUMBER') {
      if (state.houseRules.sevenZeroSwap && cardInHand.value === 0) {
        // Rotate all hands in the direction of play
        const previousHands = updatedPlayers.map((p) => ({
          hand: p.hand,
          calledUno: p.calledUno,
        }));
        updatedPlayers = updatedPlayers.map((p, idx) => {
          const sourceIdx = getNextPlayerIndex(idx, (nextDirection * -1) as PlayDirection, playerCount, 1);
          const donated = previousHands[sourceIdx]!;
          return {
            ...p,
            hand: donated.hand,
            calledUno: donated.hand.length === 1 ? donated.calledUno : false,
          };
        });
        // Update UNO vulnerability if the acting player's rotated hand changed
        const rotatedVulnerable = updatedPlayers.find(
          (p) => p.hand.length === 1 && !p.calledUno
        );
        nextUnoVulnerableId = rotatedVulnerable ? rotatedVulnerable.id : null;
        events.push({
          type: 'HANDS_SWAPPED',
          mode: 'ZERO_ROTATE',
          sourcePlayerId: action.playerId,
        });
      } else if (state.houseRules.sevenZeroSwap && cardInHand.value === 7) {
        // Stay on acting player to choose swap target
        nextPlayerIndex = playerIndex;
        nextTurnPhase = 'AWAITING_SWAP_TARGET';
      }
    } else if (cardInHand.kind === 'SKIP') {
      const skippedPlayer = updatedPlayers[nextPlayerIndex]!;
      events.push({
        type: 'TURN_SKIPPED',
        skippedPlayerId: skippedPlayer.id,
        reason: 'SKIP_CARD',
      });
      nextPlayerIndex = getNextPlayerIndex(playerIndex, nextDirection, playerCount, 2);
    } else if (cardInHand.kind === 'REVERSE') {
      nextDirection = nextDirection === 1 ? -1 : 1;
      events.push({
        type: 'DIRECTION_REVERSED',
        direction: nextDirection,
      });
      if (playerCount === 2) {
        // Reverse acts as Skip with 2 players
        const opponentIndex = getNextPlayerIndex(playerIndex, nextDirection, playerCount, 1);
        events.push({
          type: 'TURN_SKIPPED',
          skippedPlayerId: updatedPlayers[opponentIndex]!.id,
          reason: 'REVERSE_TWO_PLAYER',
        });
        nextPlayerIndex = playerIndex;
      } else {
        nextPlayerIndex = getNextPlayerIndex(playerIndex, nextDirection, playerCount, 1);
      }
    } else if (cardInHand.kind === 'DRAW_TWO') {
      if (state.houseRules.stacking) {
        nextPendingDrawCount += 2;
        nextPendingDrawKind = 'DRAW_TWO';
        nextTurnPhase = 'STACK_OR_DRAW';
        nextPlayerIndex = getNextPlayerIndex(playerIndex, nextDirection, playerCount, 1);
      } else {
        const victimIndex = nextPlayerIndex;
        const victim = updatedPlayers[victimIndex]!;
        const drawRes = drawFromDeck(nextDrawPile, nextDiscardPile, nextPrngState, 2);
        nextDrawPile = drawRes.drawPile;
        nextDiscardPile = drawRes.discardPile;
        nextPrngState = drawRes.prngState;
        events.push(...drawRes.reshuffleEvents);

        updatedPlayers = updatedPlayers.map((p, idx) =>
          idx === victimIndex
            ? {
                ...p,
                hand: [...p.hand, ...drawRes.drawn],
                calledUno: false,
                preCalledUno: false,
              }
            : p
        );

        events.push({
          type: 'CARDS_DRAWN',
          playerId: victim.id,
          count: drawRes.drawn.length,
          reason: 'DRAW_TWO',
        });
        events.push({
          type: 'TURN_SKIPPED',
          skippedPlayerId: victim.id,
          reason: 'DRAW_PENALTY',
        });
        nextPlayerIndex = getNextPlayerIndex(playerIndex, nextDirection, playerCount, 2);
      }
    } else if (cardInHand.kind === 'WILD_DRAW_FOUR') {
      if (state.houseRules.wildDrawFourChallenge && state.pendingDrawCount === 0) {
        const challengerIndex = nextPlayerIndex;
        const challenger = updatedPlayers[challengerIndex]!;
        nextWd4ChallengeState = {
          blufferPlayerId: action.playerId,
          challengerPlayerId: challenger.id,
          previousColor: state.currentColor,
          wasGuilty: hadCardOfPreviousColor,
        };
        nextPlayerIndex = challengerIndex;
        nextTurnPhase = 'AWAITING_WD4_CHALLENGE';
      } else if (state.houseRules.stacking) {
        nextPendingDrawCount += 4;
        nextPendingDrawKind = 'WILD_DRAW_FOUR';
        nextTurnPhase = 'STACK_OR_DRAW';
        nextPlayerIndex = getNextPlayerIndex(playerIndex, nextDirection, playerCount, 1);
      } else {
        const victimIndex = nextPlayerIndex;
        const victim = updatedPlayers[victimIndex]!;
        const drawRes = drawFromDeck(nextDrawPile, nextDiscardPile, nextPrngState, 4);
        nextDrawPile = drawRes.drawPile;
        nextDiscardPile = drawRes.discardPile;
        nextPrngState = drawRes.prngState;
        events.push(...drawRes.reshuffleEvents);

        updatedPlayers = updatedPlayers.map((p, idx) =>
          idx === victimIndex
            ? {
                ...p,
                hand: [...p.hand, ...drawRes.drawn],
                calledUno: false,
                preCalledUno: false,
              }
            : p
        );

        events.push({
          type: 'CARDS_DRAWN',
          playerId: victim.id,
          count: drawRes.drawn.length,
          reason: 'WILD_DRAW_FOUR',
        });
        events.push({
          type: 'TURN_SKIPPED',
          skippedPlayerId: victim.id,
          reason: 'DRAW_PENALTY',
        });
        nextPlayerIndex = getNextPlayerIndex(playerIndex, nextDirection, playerCount, 2);
      }
    }

    return {
      ok: true,
      state: {
        ...state,
        prngState: nextPrngState,
        players: updatedPlayers,
        currentPlayerIndex: nextPlayerIndex,
        direction: nextDirection,
        turnPhase: nextTurnPhase,
        drawPile: nextDrawPile,
        discardPile: nextDiscardPile,
        currentColor: nextColor,
        pendingDrawnCardId: null,
        pendingDrawCount: nextPendingDrawCount,
        pendingDrawKind: nextPendingDrawKind,
        unoVulnerablePlayerId: nextUnoVulnerableId,
        wd4ChallengeState: nextWd4ChallengeState,
        lastSeqByPlayer: updatedSeqMap,
      },
      events,
    };
  }

  return fail('INVALID_PHASE_ACTION', 'Unsupported action');
}

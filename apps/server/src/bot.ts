import {
  COLORED_SUITS,
  canPlayerPlayCard,
  type ColoredCardColor,
  type GameState,
} from '@cardclash/engine';
import type { ClientGameActionIntent } from '@cardclash/protocol';

function pickDominantHandColor(
  state: GameState,
  playerIndex: number
): ColoredCardColor {
  const player = state.players[playerIndex];
  if (!player) return 'RED';

  const counts: Record<ColoredCardColor, number> = {
    RED: 0,
    YELLOW: 0,
    GREEN: 0,
    BLUE: 0,
  };

  for (const card of player.hand) {
    if (card.color !== 'WILD') {
      counts[card.color] += 1;
    }
  }

  let bestColor: ColoredCardColor = COLORED_SUITS[0]!;
  let bestCount = -1;
  for (const color of COLORED_SUITS) {
    if (counts[color] > bestCount) {
      bestCount = counts[color];
      bestColor = color;
    }
  }
  return bestColor;
}

export type BotDifficulty = 'CASUAL' | 'BALANCED' | 'CHALLENGER';

function pickBotColor(
  state: GameState,
  playerIndex: number,
  difficulty: BotDifficulty = 'BALANCED'
): ColoredCardColor {
  const dominant = pickDominantHandColor(state, playerIndex);
  if (difficulty === 'CASUAL' && Math.random() < 0.45) {
    // In casual mode, introduce organic human variety by picking randomly from suits present
    const player = state.players[playerIndex];
    const presentColors = (player?.hand ?? [])
      .map((c) => c.color)
      .filter((col): col is ColoredCardColor => col !== 'WILD');
    if (presentColors.length > 0) {
      return presentColors[Math.floor(Math.random() * presentColors.length)]!;
    }
    return COLORED_SUITS[Math.floor(Math.random() * COLORED_SUITS.length)]!;
  }
  return dominant;
}

/**
 * Computes the next authoritative action for a server-controlled bot seat.
 */
export function computeBotActionIntent(
  state: GameState,
  botPlayerId: string,
  difficulty: BotDifficulty = 'BALANCED'
): ClientGameActionIntent | null {
  if (state.status !== 'IN_PROGRESS') {
    return null;
  }

  const playerIndex = state.players.findIndex((p) => p.id === botPlayerId);
  if (playerIndex === -1 || playerIndex !== state.currentPlayerIndex) {
    return null;
  }

  const player = state.players[playerIndex]!;
  const nextSeq = (state.lastSeqByPlayer[botPlayerId] ?? 0) + 1;
  const chosenColor = pickBotColor(state, playerIndex, difficulty);

  if (state.turnPhase === 'AWAITING_INITIAL_WILD_COLOR') {
    return {
      type: 'CHOOSE_INITIAL_COLOR',
      color: chosenColor,
      seq: nextSeq,
    };
  }

  if (state.turnPhase === 'AWAITING_ROULETTE_COLOR') {
    return {
      type: 'CHOOSE_ROULETTE_COLOR',
      color: chosenColor,
      seq: nextSeq,
    };
  }

  if (state.turnPhase === 'AWAITING_SWAP_TARGET') {
    const opponents = state.players.filter(
      (p) => p.id !== botPlayerId && !p.eliminated
    );
    if (opponents.length === 0) return null;

    let target = opponents[0]!;
    if (difficulty === 'CASUAL') {
      // In casual mode, swap with a random opponent 50% of the time instead of always targeting the leader
      target = Math.random() < 0.5
        ? opponents[Math.floor(Math.random() * opponents.length)]!
        : opponents.slice().sort((a, b) => a.hand.length - b.hand.length)[0]!;
    } else {
      opponents.sort((a, b) => a.hand.length - b.hand.length);
      target = opponents[0]!;
    }

    return {
      type: 'CHOOSE_SWAP_TARGET',
      targetPlayerId: target.id,
      seq: nextSeq,
    };
  }

  if (state.turnPhase === 'AWAITING_WD4_CHALLENGE') {
    return {
      type: 'ACCEPT_WILD_DRAW_FOUR',
      seq: nextSeq,
    };
  }

  const willLeaveOneCard = (cardId: string): boolean => {
    const card = player.hand.find((c) => c.id === cardId);
    if (!card) return false;
    if (card.kind === 'DISCARD_ALL') {
      const remaining = player.hand.filter(
        (c) => c.id !== card.id && c.color !== card.color
      );
      return remaining.length === 1;
    }
    return player.hand.length === 2;
  };

  if (state.turnPhase === 'DRAWN_PLAY_OR_PASS') {
    const drawnId = state.pendingDrawnCardId;
    if (drawnId && canPlayerPlayCard(state, botPlayerId, drawnId)) {
      const card = player.hand.find((c) => c.id === drawnId)!;
      const needsWildColor =
        card.color === 'WILD' && card.kind !== 'WILD_COLOR_ROULETTE';
      return {
        type: 'PLAY_CARD',
        cardId: card.id,
        ...(needsWildColor ? { chosenColor } : {}),
        callUno: willLeaveOneCard(card.id),
        seq: nextSeq,
      };
    }
    return {
      type: 'PASS_TURN',
      seq: nextSeq,
    };
  }

  // PLAY_OR_DRAW or STACK_OR_DRAW:
  const playableCards = player.hand.filter((c) =>
    canPlayerPlayCard(state, botPlayerId, c.id)
  );

  if (playableCards.length > 0) {
    let chosen = playableCards[0]!;

    if (difficulty === 'CASUAL') {
      // In Casual mode, play regular number cards first (70% probability) before dropping massive penalties
      const regularCards = playableCards.filter((c) => c.kind === 'NUMBER');
      if (regularCards.length > 0 && Math.random() < 0.7) {
        chosen = regularCards[Math.floor(Math.random() * regularCards.length)]!;
      } else {
        // Otherwise pick naturally from available non-wilds first
        playableCards.sort((a, b) => {
          const aWild = a.color === 'WILD' ? 1 : 0;
          const bWild = b.color === 'WILD' ? 1 : 0;
          return aWild - bWild;
        });
        chosen = playableCards[0]!;
      }
    } else {
      playableCards.sort((a, b) => {
        const aWild = a.color === 'WILD' ? 1 : 0;
        const bWild = b.color === 'WILD' ? 1 : 0;
        return aWild - bWild;
      });
      chosen = playableCards[0]!;
    }

    const needsWildColor =
      chosen.color === 'WILD' && chosen.kind !== 'WILD_COLOR_ROULETTE';
    return {
      type: 'PLAY_CARD',
      cardId: chosen.id,
      ...(needsWildColor ? { chosenColor } : {}),
      callUno: willLeaveOneCard(chosen.id),
      seq: nextSeq,
    };
  }

  return {
    type: 'DRAW_CARD',
    seq: nextSeq,
  };
}

/**
 * Computes the fallback action when a player's 30s turn timer expires:
 * auto draw / pass (or resolve pending choice phase).
 */
export function computeTurnTimeoutIntent(
  state: GameState
): { readonly playerId: string; readonly intent: ClientGameActionIntent } | null {
  if (state.status !== 'IN_PROGRESS') {
    return null;
  }

  const activePlayer = state.players[state.currentPlayerIndex];
  if (!activePlayer) return null;

  const nextSeq = (state.lastSeqByPlayer[activePlayer.id] ?? 0) + 1;
  const preferredColor = pickDominantHandColor(state, state.currentPlayerIndex);

  if (state.turnPhase === 'AWAITING_INITIAL_WILD_COLOR') {
    return {
      playerId: activePlayer.id,
      intent: {
        type: 'CHOOSE_INITIAL_COLOR',
        color: preferredColor,
        seq: nextSeq,
      },
    };
  }

  if (state.turnPhase === 'AWAITING_ROULETTE_COLOR') {
    return {
      playerId: activePlayer.id,
      intent: {
        type: 'CHOOSE_ROULETTE_COLOR',
        color: preferredColor,
        seq: nextSeq,
      },
    };
  }

  if (state.turnPhase === 'AWAITING_SWAP_TARGET') {
    const target = state.players.find(
      (p) => p.id !== activePlayer.id && !p.eliminated
    );
    if (!target) return null;
    return {
      playerId: activePlayer.id,
      intent: {
        type: 'CHOOSE_SWAP_TARGET',
        targetPlayerId: target.id,
        seq: nextSeq,
      },
    };
  }

  if (state.turnPhase === 'AWAITING_WD4_CHALLENGE') {
    return {
      playerId: activePlayer.id,
      intent: {
        type: 'ACCEPT_WILD_DRAW_FOUR',
        seq: nextSeq,
      },
    };
  }

  if (state.turnPhase === 'DRAWN_PLAY_OR_PASS') {
    return {
      playerId: activePlayer.id,
      intent: {
        type: 'PASS_TURN',
        seq: nextSeq,
      },
    };
  }

  return {
    playerId: activePlayer.id,
    intent: {
      type: 'DRAW_CARD',
      seq: nextSeq,
    },
  };
}

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

/**
 * Computes the next authoritative action for a server-controlled bot seat.
 */
export function computeBotActionIntent(
  state: GameState,
  botPlayerId: string
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
  const preferredColor = pickDominantHandColor(state, playerIndex);

  if (state.turnPhase === 'AWAITING_INITIAL_WILD_COLOR') {
    return {
      type: 'CHOOSE_INITIAL_COLOR',
      color: preferredColor,
      seq: nextSeq,
    };
  }

  if (state.turnPhase === 'AWAITING_SWAP_TARGET') {
    // Swap with the opponent who has the fewest cards
    const opponents = state.players.filter((p) => p.id !== botPlayerId);
    opponents.sort((a, b) => a.hand.length - b.hand.length);
    const target = opponents[0];
    if (!target) return null;
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

  if (state.turnPhase === 'DRAWN_PLAY_OR_PASS') {
    const drawnId = state.pendingDrawnCardId;
    if (drawnId && canPlayerPlayCard(state, botPlayerId, drawnId)) {
      const card = player.hand.find((c) => c.id === drawnId)!;
      return {
        type: 'PLAY_CARD',
        cardId: card.id,
        ...(card.color === 'WILD' ? { chosenColor: preferredColor } : {}),
        callUno: player.hand.length === 2,
        seq: nextSeq,
      };
    }
    return {
      type: 'PASS_TURN',
      seq: nextSeq,
    };
  }

  // PLAY_OR_DRAW or STACK_OR_DRAW: pick first playable card, preferring non-wilds first
  const playableCards = player.hand.filter((c) =>
    canPlayerPlayCard(state, botPlayerId, c.id)
  );
  playableCards.sort((a, b) => {
    const aWild = a.color === 'WILD' ? 1 : 0;
    const bWild = b.color === 'WILD' ? 1 : 0;
    return aWild - bWild;
  });

  const chosen = playableCards[0];
  if (chosen) {
    return {
      type: 'PLAY_CARD',
      cardId: chosen.id,
      ...(chosen.color === 'WILD' ? { chosenColor: preferredColor } : {}),
      callUno: player.hand.length === 2,
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

  if (state.turnPhase === 'AWAITING_SWAP_TARGET') {
    const target = state.players.find((p) => p.id !== activePlayer.id);
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

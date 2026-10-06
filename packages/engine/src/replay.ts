import { createGame, reduce } from './engine';
import type {
  Card,
  ColoredCardColor,
  GameAction,
  GameEvent,
  GameStatus,
  HouseRules,
  PlayDirection,
  TurnPhase,
} from './types';

export interface ReplayLogInput {
  readonly matchId: string;
  readonly seed: string;
  readonly players: readonly { readonly id: string; readonly name: string }[];
  readonly houseRules?: Partial<HouseRules>;
  readonly targetScore?: number;
  readonly actions: readonly {
    readonly index: number;
    readonly timestamp: number;
    readonly action: GameAction;
    readonly events: readonly GameEvent[];
  }[];
}

export interface ReplayPlayerSnapshot {
  readonly id: string;
  readonly name: string;
  readonly hand: readonly Card[];
  readonly score: number;
  readonly calledUno: boolean;
}

export interface ReplayFrame {
  readonly stepIndex: number;
  readonly label: string;
  readonly actorPlayerId: string | null;
  readonly action: GameAction | null;
  readonly events: readonly GameEvent[];
  readonly status: GameStatus;
  readonly roundNumber: number;
  readonly currentPlayerId: string;
  readonly direction: PlayDirection;
  readonly turnPhase: TurnPhase;
  readonly currentColor: ColoredCardColor | null;
  readonly topDiscard: Card;
  readonly discardCount: number;
  readonly drawPileCount: number;
  readonly pendingDrawCount: number;
  readonly players: readonly ReplayPlayerSnapshot[];
}

function summarizeAction(
  action: GameAction,
  players: readonly { id: string; name: string }[]
): string {
  const name = players.find((p) => p.id === action.playerId)?.name ?? action.playerId;
  switch (action.type) {
    case 'PLAY_CARD':
      return `${name} played ${action.cardId.replace(/-\d+$/, '')}${
        action.chosenColor ? ` (${action.chosenColor})` : ''
      }`;
    case 'DRAW_CARD':
      return `${name} drew from deck`;
    case 'PASS_TURN':
      return `${name} passed turn`;
    case 'CALL_UNO':
      return `${name} called UNO!`;
    case 'CATCH_UNO':
      return `${name} caught uncalled UNO!`;
    case 'CHOOSE_INITIAL_COLOR':
      return `${name} set starting suit to ${action.color}`;
    case 'CHOOSE_SWAP_TARGET':
      return `${name} swapped hands`;
    case 'CHALLENGE_WILD_DRAW_FOUR':
      return `${name} challenged Wild +4`;
    case 'ACCEPT_WILD_DRAW_FOUR':
      return `${name} accepted Wild +4`;
    case 'START_NEXT_ROUND':
      return `${name} started next round`;
  }
}

/**
 * Reconstructs every deterministic frame of a match from its initial seed and ordered action log.
 */
export function buildMatchReplayFrames(log: ReplayLogInput): readonly ReplayFrame[] {
  let state = createGame({
    matchId: log.matchId,
    seed: log.seed,
    players: log.players,
    houseRules: log.houseRules,
    targetScore: log.targetScore,
  });

  const toFrame = (
    stepIndex: number,
    label: string,
    action: GameAction | null,
    events: readonly GameEvent[]
  ): ReplayFrame => {
    const topDiscard = state.discardPile[state.discardPile.length - 1]!;
    const currentPlayer = state.players[state.currentPlayerIndex]!;
    return {
      stepIndex,
      label,
      actorPlayerId: action?.playerId ?? null,
      action,
      events,
      status: state.status,
      roundNumber: state.roundNumber,
      currentPlayerId: currentPlayer.id,
      direction: state.direction,
      turnPhase: state.turnPhase,
      currentColor: state.currentColor,
      topDiscard: { ...topDiscard },
      discardCount: state.discardPile.length,
      drawPileCount: state.drawPile.length,
      pendingDrawCount: state.pendingDrawCount,
      players: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        hand: p.hand.map((c) => ({ ...c })),
        score: p.score,
        calledUno: p.calledUno,
      })),
    };
  };

  const frames: ReplayFrame[] = [
    toFrame(0, 'Initial Deal (Seed Verified)', null, []),
  ];

  for (let i = 0; i < log.actions.length; i++) {
    const entry = log.actions[i]!;
    const reduced = reduce(state, entry.action);
    if (!reduced.ok) {
      break;
    }
    state = reduced.state;
    frames.push(
      toFrame(
        i + 1,
        summarizeAction(entry.action, log.players),
        entry.action,
        reduced.events
      )
    );
  }

  return frames;
}

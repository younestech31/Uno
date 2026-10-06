import type { GameState, OpponentView, PlayerView } from './types';

/**
 * Projects the authoritative GameState into a sanitized view for `playerId`.
 * - Includes the requesting player's full hand
 * - Includes only card counts (never card identities) for opponents
 * - Never exposes drawPile order or full discardPile history
 * - Never exposes the match seed until status === 'MATCH_OVER'
 */
export function getPlayerView(state: GameState, playerId: string): PlayerView {
  const playerIndex = state.players.findIndex((p) => p.id === playerId);
  if (playerIndex === -1) {
    throw new Error(`Player "${playerId}" is not in match "${state.matchId}"`);
  }

  const viewer = state.players[playerIndex]!;
  const topDiscard = state.discardPile[state.discardPile.length - 1];
  if (!topDiscard) {
    throw new Error('Invalid state: discardPile cannot be empty');
  }

  // Order opponents starting from the seat after viewer in clockwise order
  const opponents: OpponentView[] = [];
  const totalPlayers = state.players.length;
  for (let offset = 1; offset < totalPlayers; offset++) {
    const idx = (playerIndex + offset) % totalPlayers;
    const opp = state.players[idx]!;
    opponents.push({
      id: opp.id,
      name: opp.name,
      cardCount: opp.hand.length,
      score: opp.score,
      calledUno: opp.calledUno,
      connected: opp.connected,
    });
  }

  const currentPlayer = state.players[state.currentPlayerIndex]!;

  return {
    matchId: state.matchId,
    viewerId: viewer.id,
    status: state.status,
    roundNumber: state.roundNumber,
    currentPlayerId: currentPlayer.id,
    direction: state.direction,
    turnPhase: state.turnPhase,
    topDiscard: { ...topDiscard },
    discardCount: state.discardPile.length,
    drawPileCount: state.drawPile.length,
    currentColor: state.currentColor,
    hand: viewer.hand.map((card) => ({ ...card })),
    opponents,
    pendingDrawnCardId:
      state.currentPlayerIndex === playerIndex ? state.pendingDrawnCardId : null,
    pendingDrawCount: state.pendingDrawCount,
    unoVulnerablePlayerId: state.unoVulnerablePlayerId,
    lastSeq: state.lastSeqByPlayer[viewer.id] ?? 0,
    houseRules: { ...state.houseRules },
    targetScore: state.targetScore,
    roundWinnerId: state.roundWinnerId,
    matchWinnerId: state.matchWinnerId,
    revealedSeed: state.status === 'MATCH_OVER' ? state.seed : null,
  };
}

/**
 * Projects the authoritative GameState into a read-only spectator view.
 * - `hand` is always empty (`[]`)
 * - All seated players appear in `opponents` with card counts only (never card identities)
 * - Never exposes drawPile order or match seed until status === 'MATCH_OVER'
 */
export function getSpectatorView(
  state: GameState,
  spectatorId: string
): PlayerView {
  const topDiscard = state.discardPile[state.discardPile.length - 1];
  if (!topDiscard) {
    throw new Error('Invalid state: discardPile cannot be empty');
  }

  const opponents: OpponentView[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    cardCount: p.hand.length,
    score: p.score,
    calledUno: p.calledUno,
    connected: p.connected,
  }));

  const currentPlayer = state.players[state.currentPlayerIndex]!;

  return {
    matchId: state.matchId,
    viewerId: spectatorId,
    status: state.status,
    roundNumber: state.roundNumber,
    currentPlayerId: currentPlayer.id,
    direction: state.direction,
    turnPhase: state.turnPhase,
    topDiscard: { ...topDiscard },
    discardCount: state.discardPile.length,
    drawPileCount: state.drawPile.length,
    currentColor: state.currentColor,
    hand: [],
    opponents,
    pendingDrawnCardId: null,
    pendingDrawCount: state.pendingDrawCount,
    unoVulnerablePlayerId: state.unoVulnerablePlayerId,
    lastSeq: 0,
    houseRules: { ...state.houseRules },
    targetScore: state.targetScore,
    roundWinnerId: state.roundWinnerId,
    matchWinnerId: state.matchWinnerId,
    revealedSeed: state.status === 'MATCH_OVER' ? state.seed : null,
  };
}

import type { OpenSkillRating } from '@cardclash/protocol';

export const OPENSKILL_DEFAULT_MU = 25.0;
export const OPENSKILL_DEFAULT_SIGMA = 25.0 / 3.0;
export const OPENSKILL_BETA = 25.0 / 6.0;
export const OPENSKILL_TAU = 25.0 / 300.0;
export const OPENSKILL_KAPPA = 0.0001;

/**
 * Computes conservative OpenSkill ordinal (`mu - 3 * sigma`) and competitive display rating (`SR`).
 */
export function buildOpenSkillRating(
  mu = OPENSKILL_DEFAULT_MU,
  sigma = OPENSKILL_DEFAULT_SIGMA
): OpenSkillRating {
  const safeSigma = Math.max(1.25, sigma);
  const ordinal = Number((mu - 3 * safeSigma).toFixed(3));
  const displayRating = Math.max(
    100,
    Math.round(1000 + ordinal * 40)
  );
  return {
    mu: Number(mu.toFixed(4)),
    sigma: Number(safeSigma.toFixed(4)),
    ordinal,
    displayRating,
  };
}

export interface RatedParticipantInput {
  readonly playerId: string;
  readonly rating: OpenSkillRating;
  /** 1 = winner, 2 = 2nd place, etc. Equal numbers denote ties. */
  readonly placement: number;
}

export interface RatedParticipantOutput {
  readonly playerId: string;
  readonly before: OpenSkillRating;
  readonly after: OpenSkillRating;
  readonly ratingDelta: number;
}

/**
 * Multi-player OpenSkill (Weng-Lin Plackett-Luce Bayesian model) rating update.
 * Supports 2 to 10 players in free-for-all CardClash matches.
 */
export function updateOpenSkillRatings(
  participants: readonly RatedParticipantInput[]
): readonly RatedParticipantOutput[] {
  if (participants.length < 2) {
    return participants.map((p) => ({
      playerId: p.playerId,
      before: p.rating,
      after: p.rating,
      ratingDelta: 0,
    }));
  }

  const betaSq = OPENSKILL_BETA * OPENSKILL_BETA;
  const tauSq = OPENSKILL_TAU * OPENSKILL_TAU;

  // Step 1: Add dynamics variance tau^2 to each player's sigma^2
  const working = participants.map((p) => {
    const sigmaSq = p.rating.sigma * p.rating.sigma + tauSq;
    return {
      playerId: p.playerId,
      before: p.rating,
      mu: p.rating.mu,
      sigmaSq,
      placement: p.placement,
    };
  });

  // Step 2: Pairwise Plackett-Luce Weng-Lin updates across all opponents
  return working.map((playerI, idxI) => {
    let deltaMuSum = 0;
    let etaSum = 0;

    for (let idxQ = 0; idxQ < working.length; idxQ++) {
      if (idxI === idxQ) continue;
      const playerQ = working[idxQ]!;

      const cIq = Math.sqrt(playerI.sigmaSq + playerQ.sigmaSq + 2 * betaSq);
      const expI = Math.exp(playerI.mu / cIq);
      const expQ = Math.exp(playerQ.mu / cIq);
      const pIq = expI / (expI + expQ);

      let sIq = 0.5;
      if (playerI.placement < playerQ.placement) {
        sIq = 1.0;
      } else if (playerI.placement > playerQ.placement) {
        sIq = 0.0;
      }

      const scaleFactor = working.length > 2 ? 2 / (working.length - 1) : 1;
      deltaMuSum +=
        scaleFactor * ((playerI.sigmaSq / cIq) * (sIq - pIq));
      etaSum +=
        scaleFactor *
        ((playerI.sigmaSq / (cIq * cIq)) * pIq * (1 - pIq));
    }

    const nextMu = playerI.mu + deltaMuSum;
    const uncertaintyReduction = Math.max(1 - etaSum, OPENSKILL_KAPPA);
    const nextSigma = Math.sqrt(playerI.sigmaSq * uncertaintyReduction);

    const after = buildOpenSkillRating(nextMu, nextSigma);
    return {
      playerId: playerI.playerId,
      before: playerI.before,
      after,
      ratingDelta: after.displayRating - playerI.before.displayRating,
    };
  });
}

import { PRICED_POSITIONS, type LeagueConfig, type PlayerIndex, type Position } from "../types.ts";

/** Positions a FLEX slot may be filled from. Quarterbacks never qualify here. */
const FLEX_ELIGIBLE: readonly Position[] = ["RB", "WR", "TE"];

/**
 * Replacement level per position: the points of the best player nobody would start.
 *
 * Dedicated starters first, then FLEX filled from the best remaining RB/WR/TE BY
 * POINTS. Filling flex by VORP is degenerate — replacement is defined as the best
 * remaining player, so every position leader sits at 0 on the first pass and the
 * flattest position wins the slot. Measured in 2026, that rule handed 10 of 20 flex
 * slots to 137-point TEs over 187-point WRs.
 *
 * Computed over ALL indexed players, rostered or not: a rostered starter still sets
 * the bar for what a waiver claim is worth.
 */
export function replacementLevels(args: {
  points: ReadonlyMap<string, number>;
  index: PlayerIndex;
  config: LeagueConfig;
  /** Live teams, which shrinks as a guillotine season goes on. */
  teams: number;
}): Record<Position, number> {
  const { points, index, config, teams } = args;

  const ranked = new Map<Position, string[]>(
    PRICED_POSITIONS.map((position) => [
      position,
      [...index.values()]
        .filter((player) => player.position === position)
        .map((player) => player.playerId)
        // Points descending, then id, so equal scores never reorder between runs.
        .sort((a, b) => (points.get(b) ?? 0) - (points.get(a) ?? 0) || a.localeCompare(b)),
    ]),
  );

  /** How many at each position are spoken for: dedicated slots, then flex. */
  const taken = new Map<Position, number>(
    PRICED_POSITIONS.map((position) => [position, teams * config.starters[position]]),
  );

  for (let slot = 0; slot < teams * config.flexSlots; slot++) {
    const best = bestUnstarted(FLEX_ELIGIBLE, ranked, taken, points);
    if (!best) break;
    taken.set(best.position, (taken.get(best.position) ?? 0) + 1);
  }

  const levels = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0 } satisfies Record<Position, number>;
  for (const position of PRICED_POSITIONS) {
    const next = ranked.get(position)?.[taken.get(position) ?? 0];
    // Nobody left below the starter cut: there is no bar to clear at this position.
    levels[position] = next === undefined ? 0 : (points.get(next) ?? 0);
  }
  return levels;
}

/** The highest-scoring player at any of these positions who is not already a starter. */
function bestUnstarted(
  positions: readonly Position[],
  ranked: ReadonlyMap<Position, string[]>,
  taken: ReadonlyMap<Position, number>,
  points: ReadonlyMap<string, number>,
): { position: Position; playerId: string } | null {
  let best: { position: Position; playerId: string; points: number } | null = null;

  for (const position of positions) {
    const playerId = ranked.get(position)?.[taken.get(position) ?? 0];
    if (playerId === undefined) continue;
    const candidate = points.get(playerId) ?? 0;
    if (!best || candidate > best.points) best = { position, playerId, points: candidate };
  }

  return best ? { position: best.position, playerId: best.playerId } : null;
}

/**
 * A player's points above his position's replacement level.
 *
 * Never negative: a player below replacement is a row to drop, not a debt the economy
 * has to carry.
 */
export function vorp(points: number, replacement: number): number {
  return Math.max(0, points - replacement);
}

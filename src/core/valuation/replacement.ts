import type { LeagueConfig, PlayerIndex, Position } from "../types.ts";

/**
 * Replacement level per position: the points of the best player nobody would start.
 *
 * Contract:
 *  - Dedicated starters first: with `teams` teams each starting `s` at a position,
 *    the top `teams × s` players at that position are starters.
 *  - FLEX slots are then filled from the best remaining RB/WR/TE BY POINTS — not by
 *    VORP. Selecting flex by VORP is degenerate: replacement is defined as the best
 *    remaining player, so every position leader sits at 0 on the first pass and the
 *    flattest position wins the slot. Measured in 2026: the VORP rule handed 10 of 20
 *    flex slots to 137-point TEs over 187-point WRs.
 *  - After flex is filled, replacement for each position is the best UNSTARTED player
 *    at that position; iterate until the assignment stops changing.
 *  - Replacement is computed over ALL indexed players, rostered or not — a rostered
 *    starter still sets the bar for what a waiver claim is worth.
 *  - A position with no players left below the starter cut has replacement 0.
 */
export function replacementLevels(_args: {
  points: ReadonlyMap<string, number>;
  index: PlayerIndex;
  config: LeagueConfig;
  /** Live teams, which shrinks as a guillotine season goes on. */
  teams: number;
}): Record<Position, number> {
  throw new Error("not implemented");
}

/** VORP for one player: his points above his position's replacement level, floored at nothing. */
export function vorp(_points: number, _replacement: number): number {
  throw new Error("not implemented");
}

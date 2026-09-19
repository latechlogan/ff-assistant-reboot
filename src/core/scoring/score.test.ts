import { describe, expect, test } from "vitest";
import { leagueFixture, projectionsFixture } from "../../../test/load-fixtures.ts";
import { scoreStatLine } from "./score.ts";

/**
 * AC3 — points are computed locally from the league's own `scoring_settings`, and no
 * `pts_*` field from any feed is read.
 * AC4 — a bye row (no `gp`, no `game_id`, stats holding only `adp_dd_ppr`) scores 0.0
 * and does not throw.
 */

const SCORING = leagueFixture().scoring_settings;

/** The fixture projection row for this player, or a loud failure if it was retrimmed away. */
function statsFor(playerId: string): Record<string, number> {
  const row = projectionsFixture().find((r) => r.player_id === playerId);
  if (!row) throw new Error(`fixture has no projection row for ${playerId}`);
  return row.stats;
}

describe("scoring a real stat line under a real league's rules", () => {
  test("AC3 — scores stat lines locally, never a pre-scored pts_* field", () => {
    const stats = statsFor("421"); // Matthew Stafford, week 2

    const points = scoreStatLine(stats, SCORING);

    /**
     * Every stat that carries a weight in this league, and nothing else:
     *   pass_yd   249.24 × 0.04 =  9.9696
     *   pass_td     1.74 × 6    = 10.44
     *   pass_int    0.65 × −1   = −0.65
     *   pass_2pt    0.13 × 2    =  0.26
     *   rush_yd     3.64 × 0.1  =  0.364
     *   rush_td     0.06 × 6    =  0.36
     *   rush_2pt       0 × 2    =  0
     *   fum         0.46 × 0    =  0
     *   fum_lost     0.2 × −2   = −0.4
     *                            ────────
     *                             20.3436
     */
    expect(points).toBeCloseTo(20.3436, 6);
    // The feed's own pts_ppr for this row is 16.84 — scored at 4-point passing TDs.
    // Reading it would understate Stafford by 1.74 TDs × 2 points.
    expect(stats["pts_ppr"]).toBe(16.84);
    expect(points).not.toBeCloseTo(16.84, 2);
  });

  test("AC3 — pre-scored and market fields are ignored even when the league weights them", () => {
    // A hostile payload: the league lists weights for the very fields that must never
    // be read. Only pass_yd may contribute.
    const stats = { pass_yd: 100, pts_ppr: 99, pts_std: 99, adp_dd_ppr: 50, pos_adp_dd_ppr: 3 };
    const scoring = { pass_yd: 0.04, pts_ppr: 1, pts_std: 1, adp_dd_ppr: 1, pos_adp_dd_ppr: 1 };

    // 100 × 0.04 = 4. Summing the rest as well would give 4 + 99 + 99 + 50 + 3 = 255.
    expect(scoreStatLine(stats, scoring)).toBeCloseTo(4, 10);
  });

  test("AC3 — a stat with no weight contributes nothing, and negative weights apply as given", () => {
    const stats = { rush_yd: 50, tackle_solo: 9, pass_int: 2, fum_lost: 1 };

    // 50 × 0.1 = 5; tackle_solo has no weight in this league; 2 × −1 = −2; 1 × −2 = −2.
    expect(scoreStatLine(stats, SCORING)).toBeCloseTo(1, 10);
  });
});

describe("a week a player does not play", () => {
  test("AC4 — a statless bye row scores exactly 0.0 and does not throw", () => {
    const stats = statsFor("6744"); // Greg Ward: the fixture's one statless row

    expect(Object.keys(stats)).toEqual(["adp_dd_ppr"]); // no gp, no game_id, ADP only
    expect(scoreStatLine(stats, SCORING)).toBe(0);
  });

  test("REG 2026-09-13 — a bye is a MISSING `gp`, not `gp: 0`, so `gp` gates nothing", () => {
    // The 2026 tool looked for `gp: 0`. Sleeper does not send it: a bye row has no `gp`
    // key at all. An implementation that treats `gp` as a played/not-played gate would
    // zero this row, which is a real stat line that happens to carry gp: 0.
    const stats = { gp: 0, rec: 5, rec_yd: 50, rec_td: 1 };

    // 5 × 1 + 50 × 0.1 + 1 × 6 = 5 + 5 + 6 = 16. `gp` carries no weight, so it adds nothing.
    expect(scoreStatLine(stats, SCORING)).toBeCloseTo(16, 10);
    // And the shape Sleeper really sends for a bye still scores 0.
    expect(scoreStatLine({ adp_dd_ppr: 1000 }, SCORING)).toBe(0);
  });

  test("AC4 — an empty stat line scores 0 rather than throwing", () => {
    expect(scoreStatLine({}, SCORING)).toBe(0);
  });
});

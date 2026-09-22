import { describe, expect, test } from "vitest";
import { leagueFixture, playersFixture, projectionsFixture } from "../../../test/load-fixtures.ts";
import { scoreStatLine } from "./score.ts";

/**
 * Ticket 001:
 * AC3 — points are computed locally from the league's own `scoring_settings`, and no
 * `pts_*` field from any feed is read.
 * AC4 — a bye row (no `gp`, no `game_id`, stats holding only `adp_dd_ppr`) scores 0.0
 * and does not throw.
 *
 * Ticket 008 (`AC1`, `AC2`, `AC5` below, written before the implementation):
 * a 50+ yard field goal must stop scoring zero. The names collide with ticket 001's
 * `AC3`/`AC4` only across tickets, never within one; `pnpm criteria` is scoped to the
 * ticket in flight.
 */

const SCORING = leagueFixture().scoring_settings;

/** The fixture projection row for this player, or a loud failure if it was retrimmed away. */
function statsFor(playerId: string): Record<string, number> {
  const row = projectionsFixture().find((r) => r.player_id === playerId);
  if (!row) throw new Error(`fixture has no projection row for ${playerId}`);
  return row.stats;
}

describe("scoring a real stat line under a real league's rules", () => {
  test("001 AC3 — scores stat lines locally, never a pre-scored pts_* field", () => {
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

  test("001 AC3 — pre-scored and market fields are ignored even when the league weights them", () => {
    // A hostile payload: the league lists weights for the very fields that must never
    // be read. Only pass_yd may contribute.
    const stats = { pass_yd: 100, pts_ppr: 99, pts_std: 99, adp_dd_ppr: 50, pos_adp_dd_ppr: 3 };
    const scoring = { pass_yd: 0.04, pts_ppr: 1, pts_std: 1, adp_dd_ppr: 1, pos_adp_dd_ppr: 1 };

    // 100 × 0.04 = 4. Summing the rest as well would give 4 + 99 + 99 + 50 + 3 = 255.
    expect(scoreStatLine(stats, scoring)).toBeCloseTo(4, 10);
  });

  test("001 AC3 — a stat with no weight contributes nothing, and negative weights apply as given", () => {
    const stats = { rush_yd: 50, tackle_solo: 9, pass_int: 2, fum_lost: 1 };

    // 50 × 0.1 = 5; tackle_solo has no weight in this league; 2 × −1 = −2; 1 × −2 = −2.
    expect(scoreStatLine(stats, SCORING)).toBeCloseTo(1, 10);
  });
});

describe("a week a player does not play", () => {
  test("001 AC4 — a statless bye row scores exactly 0.0 and does not throw", () => {
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

  test("001 AC4 — an empty stat line scores 0 rather than throwing", () => {
    expect(scoreStatLine({}, SCORING)).toBe(0);
  });
});

/**
 * Ticket 008 — a 50+ yard field goal scores zero, silently.
 *
 * The chopped league scores field goals by distance (`fgm_50_59` 5, `fgm_60p` 6) and
 * has no `fgm_50p` rule. Sleeper's projections report one combined `fgm_50p` bucket,
 * so today it matches nothing and every 50+ kick is worth 0. The fix is granularity
 * translation of a stat we DO have — never fabrication of one we don't.
 *
 * The fixture league (`test/fixtures/league-guillotine.json`) has the same shape:
 * `fgm_50_59: 5`, `fgm_60p: 6`, and no `fgm_50p` key.
 */
describe("the fgm_50p bridge", () => {
  test("008 AC1 — fgm_50p scores at the league's fgm_50_59 rate when the league has no fgm_50p rule", () => {
    // The fixture league is the shape the ticket describes, or this test proves nothing.
    expect(SCORING["fgm_50_59"]).toBe(5);
    expect(SCORING["fgm_50p"]).toBeUndefined();

    // Spencer Shrader's real week-3 rate: 0.36 makes of 50+ a week.
    // 0.36 × 5 = 1.8 — the points thrown away every week today.
    expect(scoreStatLine({ fgm_50p: 0.36 }, SCORING)).toBeCloseTo(1.8, 10);
  });

  test("008 AC1 — a league with its own fgm_50p rule uses that rule, and the bridge does not fire", () => {
    const scoring = { fgm_50p: 2, fgm_50_59: 5 };

    // 0.36 × 2 = 0.72, this league's own rate. Bridging to fgm_50_59 anyway would give
    // 0.36 × 5 = 1.8, silently overruling a setting the league actually chose.
    expect(scoreStatLine({ fgm_50p: 0.36 }, scoring)).toBeCloseTo(0.72, 10);
  });

  test("008 AC1 — a league's own fgm_50p rule is used even when it is zero or negative", () => {
    // `0` is the trap: an implementation that bridges on a FALSY weight rather than an
    // ABSENT one turns a league's deliberate "50+ kicks are worth nothing" into 5.
    expect(scoreStatLine({ fgm_50p: 0.36 }, { fgm_50p: 0, fgm_50_59: 5 })).toBeCloseTo(0, 10);
    // 0.4 × −1 = −0.4, not 0.4 × 5 = 2.
    expect(scoreStatLine({ fgm_50p: 0.4 }, { fgm_50p: -1, fgm_50_59: 5 })).toBeCloseTo(-0.4, 10);
  });

  test("008 AC1 — no other stat key is bridged", () => {
    // The ticket names the miss buckets and rules them out BY NAME: three feed keys
    // collapsing into one `fgmiss` rule is a different shape from one made-bucket
    // splitting into two, and it needs its own decision. Bridging them here is
    // out of scope, so each must still contribute exactly 0.
    expect(SCORING["fgmiss"]).toBe(-1);
    for (const miss of ["fgmiss_30_39", "fgmiss_40_49", "fgmiss_50p"]) {
      expect(SCORING[miss]).toBeUndefined();
      // Bridging to `fgmiss` would give 0.5 × −1 = −0.5.
      expect(scoreStatLine({ [miss]: 0.5 }, SCORING)).toBe(0);
    }

    // The other unweighted kicker keys are totals and raw yardage, not buckets. They
    // must stay at 0 too: `fgm` and `fga` already count the same kicks the buckets do,
    // so weighting either of them would double the whole position.
    for (const key of ["fga", "fgm", "fgm_yds", "xpa"]) {
      expect(SCORING[key]).toBeUndefined();
      expect(scoreStatLine({ [key]: 2 }, SCORING)).toBe(0);
    }

    // And nothing splits into `fgm_60p`: a 60-yard make scores at the 50_59 rate. That
    // 1-point undercount is stated in the ticket and is the price of the bridge.
    expect(SCORING["fgm_60p"]).toBe(6);
    expect(scoreStatLine({ fgm_50p: 1 }, SCORING)).toBeCloseTo(5, 10); // 5 — not 6, not 11
  });

  test("008 AC2 — a line carrying both fgm_50p and fgm_50_59 scores each once, at its own rule", () => {
    // fgm_50p    0.36 × 5 (bridged)        = 1.8
    // fgm_50_59  0.4  × 5 (its own rule)   = 2.0
    //                                        ─────
    //                                          3.8
    // Counting fgm_50_59 twice would give 5.8; counting fgm_50p twice, 5.6.
    expect(scoreStatLine({ fgm_50p: 0.36, fgm_50_59: 0.4 }, SCORING)).toBeCloseTo(3.8, 10);
  });

  test("008 AC2 — where the league scores both keys, each is scored at its own rate, once", () => {
    const scoring = { fgm_50p: 2, fgm_50_59: 5 };

    // 0.36 × 2 = 0.72 plus 0.4 × 5 = 2.0 → 2.72. No bridge fires: both keys have rules.
    expect(scoreStatLine({ fgm_50p: 0.36, fgm_50_59: 0.4 }, scoring)).toBeCloseTo(2.72, 10);
  });

  test("008 AC2 — a whole kicker line scores every bucket once, bridge included", () => {
    // Spencer Shrader's real week-3 line, the row the parity check found. Field-goal
    // and extra-point keys only; the feed's own pts_* and adp fields are never read.
    const stats = {
      fgm_20_29: 0.36,
      fgm_30_39: 0.48,
      fgm_40_49: 0.54,
      fgm_50p: 0.36,
      xpm: 2.4,
      xpmiss: 0.06,
    };

    /**
     * fgm_20_29  0.36 ×  3 =  1.08
     * fgm_30_39  0.48 ×  3 =  1.44
     * fgm_40_49  0.54 ×  4 =  2.16
     * fgm_50p    0.36 ×  5 =  1.80   ← 0 today: the whole defect, one week of it
     * xpm        2.4  ×  1 =  2.40
     * xpmiss     0.06 × −1 = −0.06
     *                        ───────
     *                           8.82
     */
    expect(scoreStatLine(stats, SCORING)).toBeCloseTo(8.82, 10);
    // Without the bridge the same line scores 7.02 — the ~20% kicker shortfall.
    expect(scoreStatLine(stats, SCORING) - 1.8).toBeCloseTo(7.02, 10);
  });
});

/**
 * The algorithm as it stood before ticket 008, written out so "identical before and
 * after" is a comparison a test can make rather than a claim in a commit message.
 * Transcribed from `scoreStatLine` at commit 519c815.
 */
function scoreBefore(
  stats: Readonly<Record<string, number>>,
  scoring: Readonly<Record<string, number>>,
): number {
  let points = 0;
  for (const [stat, value] of Object.entries(stats)) {
    if (stat.startsWith("pts_") || stat.includes("adp")) continue;
    const weight = scoring[stat];
    if (weight === undefined) continue;
    points += value * weight;
  }
  return points;
}

describe("the blast radius of the bridge", () => {
  test("008 AC5 — every non-K fixture row scores exactly what it scored before the bridge", () => {
    const players = playersFixture();
    const rows = projectionsFixture().filter((row) => players[row.player_id]?.position !== "K");

    // 86 fixture rows, 13 of them kickers. Without this the test could pass by vacuum
    // if a retrim ever emptied the fixture.
    expect(rows.length).toBe(73);

    for (const row of rows) {
      expect(scoreStatLine(row.stats, SCORING)).toBe(scoreBefore(row.stats, SCORING));
      // And the reason it cannot move: no non-kicker row carries a field-goal key at
      // all, so nothing outside K is even a candidate for bridging.
      expect(Object.keys(row.stats).filter((key) => key.startsWith("fg"))).toEqual([]);
    }
  });

  test("008 AC5 — on these fixtures even the K rows are unmoved, because the week-2 feed sent no fgm_50p", () => {
    const players = playersFixture();
    const kickers = projectionsFixture().filter((row) => players[row.player_id]?.position === "K");

    expect(kickers.length).toBe(13);

    for (const row of kickers) {
      // The committed fixture is a week-2 payload and the feed carried no `fgm_50p`
      // that week — the key first appears in week 3. So a bridge that fired on `fgm`,
      // `fga`, `fgm_yds` or a miss bucket would move these rows, and fail here.
      expect(row.stats["fgm_50p"]).toBeUndefined();
      expect(scoreStatLine(row.stats, SCORING)).toBe(scoreBefore(row.stats, SCORING));
    }
  });
});

import { describe, expect, test } from "vitest";
import { survivalWeights } from "./weights.ts";

/**
 * The survival curve is the league's own chop cadence, not a shape chosen because it
 * looks right (tickets/001, "Boundary"; REVIEW.md, "measured or invented"). Every
 * expectation below is arithmetic from one chop per week at uniform risk, written out
 * so the curve can be checked by hand rather than trusted.
 *
 * Named REG rather than AC: these guard the standing caution logged 2026-09-18 that
 * no weighting in this tool may be invented. The criterion they serve (AC1's weighted
 * rest-of-season column) is proved at the CLI level.
 */

describe("the shape of the curve", () => {
  test("REG 2026-09-18 — week one is certain, and each later week compounds the chance of surviving the chops before it", () => {
    // `weeksRemaining` is the rest of the SEASON, not an arbitrary window: the capacity
    // guard below is only meaningful under that reading, and a 16-team league with 4
    // weeks left cannot finish. The horizon is season-length; the first four weights
    // are the same numbers the original window asserted.
    const weights = survivalWeights({ liveTeams: 16, weeksRemaining: 17, chopsPerWeek: 1 });

    /**
     * You are alive now, so the first remaining week is weight 1.
     *   week 2: survive 16 → 15/16              = 0.9375
     *   week 3: × survive 15 → 15/16 × 14/15    = 14/16 = 0.875
     *   week 4: × survive 14 → 14/16 × 13/14    = 13/16 = 0.8125
     */
    expect(weights).toHaveLength(17);
    expect(weights[0]).toBe(1);
    expect(weights[1]).toBeCloseTo(0.9375, 10);
    expect(weights[2]).toBeCloseTo(0.875, 10);
    expect(weights[3]).toBeCloseTo(0.8125, 10);
  });

  test("REG 2026-09-18 — a cadence of two chops a week compounds the same way, twice as fast", () => {
    // Season-length horizon again: 15 chops at 2 a week need 8 weeks.
    const weights = survivalWeights({ liveTeams: 16, weeksRemaining: 8, chopsPerWeek: 2 });

    /**
     *   week 2: (16 − 2)/16                     = 14/16 = 0.875
     *   week 3: 14/16 × (14 − 2)/14             = 12/16 = 0.75
     */
    expect(weights).toHaveLength(8);
    expect(weights[0]).toBe(1);
    expect(weights[1]).toBeCloseTo(0.875, 10);
    expect(weights[2]).toBeCloseTo(0.75, 10);
  });

  test("REG 2026-09-18 — every weight is in (0, 1] and never rises: 16 teams over 17 weeks is normal", () => {
    const weights = survivalWeights({ liveTeams: 16, weeksRemaining: 17, chopsPerWeek: 1 });

    expect(weights).toHaveLength(17);
    for (const [i, weight] of weights.entries()) {
      expect(weight).toBeGreaterThan(0); // a weight of 0 would erase a week's points
      expect(weight).toBeLessThanOrEqual(1);
      expect(weight).toBeLessThanOrEqual(weights[i - 1] ?? 1);
    }
    /**
     * After 15 chops one team is left and nobody else can be chopped, so the curve
     * flattens at 1/16 = 0.0625 rather than running through zero into nonsense.
     */
    expect(weights[15]).toBeCloseTo(0.0625, 10);
    expect(weights[16]).toBeCloseTo(0.0625, 10);
  });
});

describe("the capacity guard", () => {
  test("REG 2026-09-18 — a season that cannot chop its teams in the weeks it has raises rather than clamping", () => {
    // 20 live teams need 19 chops; 5 weeks at one a week can deliver 5. That is a
    // contradiction in the inputs, and a silently clamped curve would price on it.
    const call = (): number[] =>
      survivalWeights({ liveTeams: 20, weeksRemaining: 5, chopsPerWeek: 1 });

    expect(call).toThrow(/team|week|chop/i);
  });

  test("001 AC8 — the same league state produces the same weights twice", () => {
    const args = { liveTeams: 13, weeksRemaining: 13, chopsPerWeek: 1 };

    expect(survivalWeights(args)).toEqual(survivalWeights(args));
  });
});

import { describe, expect, test } from "vitest";
import type { WeeklyPoints } from "../types.ts";
import { restOfSeasonPoints } from "./points.ts";

/**
 * Rest-of-season points: the weeks still to come, weighted by the chance of being
 * alive to collect them.
 *
 * Named REG rather than AC: these guard the contract's stated failure mode — weekly
 * points are keyed by ABSOLUTE week while weights are indexed from the anchor week,
 * and mixing the two is the cheapest wrong-but-plausible price available. The
 * criterion they serve (AC1's weighted column) is proved at the CLI level.
 */

const weekly: WeeklyPoints[] = [
  { playerId: "p1", week: 1, points: 99 }, // already played: never counted
  { playerId: "p1", week: 2, points: 10 },
  { playerId: "p1", week: 3, points: 20 },
  { playerId: "p1", week: 5, points: 5 }, // past the horizon: never counted
  { playerId: "p2", week: 3, points: 7 }, // no week-2 row: that week contributes 0
  { playerId: "p3", week: 1, points: 40 }, // only a played week
];

const got = (points: ReadonlyMap<string, number>, playerId: string): number =>
  points.get(playerId) ?? Number.NaN;

describe("summing the weeks still to come", () => {
  test("REG 2026-09-18 — only weeks from the anchor through the last week count, and a missing week is 0", () => {
    const points = restOfSeasonPoints({ weekly, fromWeek: 2, throughWeek: 4 });

    expect(got(points, "p1")).toBeCloseTo(30, 10); // 10 (wk2) + 20 (wk3) + 0 (wk4)
    expect(got(points, "p2")).toBeCloseTo(7, 10); // 0 (wk2) + 7 (wk3) + 0 (wk4)
    // p3's only row is week 1, which is behind the anchor: he is worth nothing ahead.
    expect(points.get("p3") ?? 0).toBe(0);
  });

  test("REG 2026-09-18 — weights are anchored at fromWeek, indexed by remaining week and not by week number", () => {
    // weights[0] applies to week 2, weights[1] to week 3, weights[2] to week 4.
    const points = restOfSeasonPoints({
      weekly,
      fromWeek: 2,
      throughWeek: 4,
      weights: [1, 0.5, 0.25],
    });

    /**
     * p1: 10 × 1 + 20 × 0.5 = 20.
     * p2:  7 × 0.5          =  3.5.
     * Indexing the weights by absolute week instead would give p1 10 × 0.5 + 20 × 0.25
     * = 10 and p2 7 × 0.25 = 1.75 — plausible numbers, and wrong ones.
     */
    expect(got(points, "p1")).toBeCloseTo(20, 10);
    expect(got(points, "p2")).toBeCloseTo(3.5, 10);
  });

  test("REG 2026-09-18 — a league with no chops is unweighted, not weighted by 1s it invented", () => {
    const unweighted = restOfSeasonPoints({ weekly, fromWeek: 2, throughWeek: 3 });
    const flat = restOfSeasonPoints({ weekly, fromWeek: 2, throughWeek: 3, weights: [1, 1] });

    expect(got(unweighted, "p1")).toBeCloseTo(30, 10); // 10 + 20
    expect(got(flat, "p1")).toBeCloseTo(got(unweighted, "p1"), 10);
  });

  test("001 AC8 — the same weeks produce the same totals twice", () => {
    const args = { weekly, fromWeek: 2, throughWeek: 4, weights: [1, 0.9, 0.8] };

    expect([...restOfSeasonPoints(args)]).toEqual([...restOfSeasonPoints(args)]);
  });
});

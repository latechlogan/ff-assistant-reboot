import { describe, expect, test } from "vitest";
import type { IndexedPlayer, LeagueConfig, PlayerIndex, Position } from "../types.ts";
import { replacementLevels, vorp } from "./replacement.ts";

/**
 * Replacement level is the points of the best player nobody would start. The rows are
 * hand-built rather than taken from a fixture because every expectation here is an
 * ordering argument, and a fixture would bury it.
 *
 * Named REG rather than AC: these guard the measured 2026 learning that filling FLEX
 * by VORP is degenerate — it handed 10 of 20 flex slots to 137-point TEs over
 * 187-point WRs. The criterion they serve (AC1's VORP column) is proved at the CLI
 * level; the closed economy built on top of them is AC7.
 */

type Row = { id: string; position: Position; points: number };

/** A deep roster of every priced position, with a clear points ordering at each. */
const ROWS: Row[] = [
  { id: "q1", position: "QB", points: 300 },
  { id: "q2", position: "QB", points: 200 },
  { id: "r1", position: "RB", points: 120 },
  { id: "r2", position: "RB", points: 60 },
  { id: "r3", position: "RB", points: 30 },
  { id: "w1", position: "WR", points: 200 },
  { id: "w2", position: "WR", points: 187 },
  { id: "w3", position: "WR", points: 100 },
  { id: "t1", position: "TE", points: 150 },
  { id: "t2", position: "TE", points: 137 },
  { id: "t3", position: "TE", points: 40 },
  { id: "k1", position: "K", points: 10 },
  { id: "k2", position: "K", points: 5 },
];

function indexOf(rows: readonly Row[]): PlayerIndex {
  const index = new Map<string, IndexedPlayer>();
  for (const row of rows) {
    index.set(row.id, { playerId: row.id, name: row.id, position: row.position, team: null });
  }
  return index;
}

function pointsOf(rows: readonly Row[]): ReadonlyMap<string, number> {
  return new Map(rows.map((row) => [row.id, row.points]));
}

function configWith(starters: Record<Position, number>, flexSlots: number): LeagueConfig {
  return {
    leagueId: "fixture",
    season: "2026",
    teams: 1,
    draftBudget: null,
    rosterPositions: [],
    starters,
    flexSlots,
    benchSlots: 0,
    rosterSize: 0,
    scoring: {},
    format: "guillotine",
    waiver: { kind: "faab", budget: 1000, minBid: 0 },
  };
}

const ONE_OF_EACH: Record<Position, number> = { QB: 1, RB: 1, WR: 1, TE: 1, K: 1 };

describe("replacement level", () => {
  test("REG 2026-09-18 — FLEX is filled by points, not by VORP", () => {
    const config = configWith(ONE_OF_EACH, 1);

    const levels = replacementLevels({
      points: pointsOf(ROWS),
      index: indexOf(ROWS),
      config,
      teams: 1,
    });

    /**
     * One team, one dedicated slot each: q1, r1, w1, t1, k1 are starters. The flex is
     * then the best remaining RB/WR/TE by POINTS — w2 at 187, ahead of t2 at 137.
     * Replacement is the best unstarted player at each position:
     *   QB q2 200 · RB r2 60 · WR w3 100 · TE t2 137 · K k2 5
     *
     * By VORP instead, every position leader sits at 0 on the first pass (replacement
     * is defined as the best remaining player), so the flattest position takes the
     * slot: t2 wins the flex, WR replacement stays 187 and TE drops to t3's 40. Both
     * of those numbers are asserted against here.
     */
    expect(levels.QB).toBeCloseTo(200, 10);
    expect(levels.RB).toBeCloseTo(60, 10);
    expect(levels.WR).toBeCloseTo(100, 10);
    expect(levels.TE).toBeCloseTo(137, 10);
    expect(levels.K).toBeCloseTo(5, 10);
  });

  test("REG 2026-09-18 — only RB/WR/TE may fill a FLEX, however many points a QB has", () => {
    // q2 is now the best player in the league by a distance. He is still not flex-eligible.
    const rows = ROWS.map((row) => (row.id === "q2" ? { ...row, points: 500 } : row));

    const levels = replacementLevels({
      points: pointsOf(rows),
      index: indexOf(rows),
      config: configWith(ONE_OF_EACH, 1),
      teams: 1,
    });

    /**
     * QB slot goes to q2 (500), so q1 (300) is the best unstarted QB. The flex still
     * goes to w2 (187), leaving w3 (100) as WR replacement.
     *
     * If QBs could fill a flex, q1 would take it: QB replacement would fall to 0 (no
     * QB left) and WR replacement would rise to 187.
     */
    expect(levels.QB).toBeCloseTo(300, 10);
    expect(levels.WR).toBeCloseTo(100, 10);
    expect(levels.TE).toBeCloseTo(137, 10);
  });

  test("REG 2026-09-18 — the starter cut is teams × slots, so a chopped league raises the bar", () => {
    const config = configWith(ONE_OF_EACH, 0);
    const args = { points: pointsOf(ROWS), index: indexOf(ROWS), config };

    const sixteenth = replacementLevels({ ...args, teams: 2 });
    const finalTwo = replacementLevels({ ...args, teams: 1 });

    // teams = 2: the top 2 at each position start, so replacement is the 3rd best —
    // WR w3 100, RB r3 30. teams = 1: the 2nd best — WR w2 187, RB r2 60.
    expect(sixteenth.WR).toBeCloseTo(100, 10);
    expect(sixteenth.RB).toBeCloseTo(30, 10);
    expect(finalTwo.WR).toBeCloseTo(187, 10);
    expect(finalTwo.RB).toBeCloseTo(60, 10);
  });

  test("REG 2026-09-18 — a position with nobody below the starter cut has replacement 0", () => {
    const rows = ROWS.filter((row) => ["q1", "r1", "w1", "t1", "k1"].includes(row.id));

    const levels = replacementLevels({
      points: pointsOf(rows),
      index: indexOf(rows),
      config: configWith(ONE_OF_EACH, 0),
      teams: 1,
    });

    // Exactly one startable player at each position, so nobody is left to set a bar.
    expect(levels).toEqual({ QB: 0, RB: 0, WR: 0, TE: 0, K: 0 });
  });
});

describe("VORP", () => {
  test("001 AC10 — below-replacement players are floored at 0, so dropped rows are countable", () => {
    expect(vorp(120, 100)).toBeCloseTo(20, 10);
    expect(vorp(100, 100)).toBe(0); // exactly replacement is worth nothing over it
    expect(vorp(90, 100)).toBe(0); // never negative: a row to drop, not a debt

    const points = [120, 100, 90, 101];
    const dropped = points.filter((p) => vorp(p, 100) === 0);

    expect(dropped).toHaveLength(2);
  });
});

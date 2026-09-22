import { describe, expect, test } from "vitest";
import { allocateFaab } from "./allocate.ts";

/**
 * AC7 — value over the available rows sums to the distributable share of the FAAB
 * pool, asserted against that named population.
 *
 * The population matters more than the identity: summing `value` over every row of a
 * 2026 board gave ~$6,526 against a $3,600 pool, because thousands of rows sat at the
 * floor (docs/trust.md). So every sum below is taken over the exact keys that were
 * priced, and the floor component is named rather than swept into the total.
 *
 * Hand-built numbers: the arithmetic is the whole point, and a fixture would hide it.
 */

/** Three available rows worth 60, 30 and 10 VORP: Σ VORP(available) = 100. */
const AVAILABLE = new Map([
  ["a", 60],
  ["b", 30],
  ["c", 10],
]);

/** Three live rosters holding 200, 100 and 60 VORP: 360 / 3 = 120 per team. */
const ROSTERED = [200, 100, 60];

const got = (values: ReadonlyMap<string, number>, id: string): number =>
  values.get(id) ?? Number.NaN;

const total = (values: ReadonlyMap<string, number>): number =>
  [...values.values()].reduce((sum, value) => sum + value, 0);

describe("spreading the pool over the season's supply", () => {
  test("001 AC7 — value over the available rows sums to the pool's share of the supply", () => {
    const { values, diagnostics } = allocateFaab({
      availableVorp: AVAILABLE,
      rosteredVorpByTeam: ROSTERED,
      pool: 1000,
      floor: 0,
      chopsRemaining: 2,
    });

    /**
     * supply = 100 (available) + 2 chops × 120 rostered per team = 340.
     * $/VORP  = 1000 / 340 = 2.941176…
     *   a: 60 × 2.941176… = 176.470588…
     *   b: 30 × 2.941176… =  88.235294…
     *   c: 10 × 2.941176… =  29.411765…
     *   Σ over the available rows = 1000 × 100 / 340 = 294.117647…
     */
    expect(got(values, "a")).toBeCloseTo(176.470588, 6);
    expect(got(values, "b")).toBeCloseTo(88.235294, 6);
    expect(got(values, "c")).toBeCloseTo(29.411765, 6);

    // The identity, over the population it closes on: the three rows that were priced.
    expect([...values.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(total(values)).toBeCloseTo((1000 * 100) / 340, 6);
    // Less than the pool, because two future chops will release supply of their own.
    expect(total(values)).toBeLessThan(diagnostics.pool);
  });

  test("REG 2026-09-18 — the supply is the season's, not this week's: future chops hold money back", () => {
    const args = {
      availableVorp: AVAILABLE,
      rosteredVorpByTeam: ROSTERED,
      pool: 1000,
      floor: 0,
    };

    const lastChop = allocateFaab({ ...args, chopsRemaining: 0 });
    const midSeason = allocateFaab({ ...args, chopsRemaining: 2 });

    /**
     * With no chops left, the supply is this week's pool of VORP (100) and the economy
     * closes exactly on the pool: a is worth 60 / 100 × 1000 = 600.
     *
     * With two chops still to come, supply is 340 and the same row is worth 176.47.
     * Pricing this week's players over the whole pool is what put the top 2026 waiver
     * player at $3,578 of a $15,000 pool.
     */
    expect(got(lastChop.values, "a")).toBeCloseTo(600, 6);
    expect(total(lastChop.values)).toBeCloseTo(1000, 6);
    expect(got(midSeason.values, "a")).toBeCloseTo(176.470588, 6);
    expect(got(midSeason.values, "a")).toBeLessThan(got(lastChop.values, "a"));
  });

  test("001 AC7 — the identity still closes over the available rows once a floor is paid", () => {
    const availableVorp = new Map([
      ["a", 60],
      ["b", 0],
      ["c", 0],
    ]);

    const { values, diagnostics } = allocateFaab({
      availableVorp,
      rosteredVorpByTeam: [10],
      pool: 100,
      floor: 1,
      chopsRemaining: 1,
    });

    /**
     * supply = 60 + 1 chop × 10 = 70. Σ VORP(available) = 60.
     * Two of the three rows are worth nothing over replacement, so they get the floor
     * and nothing else — the $1 rows that make an unnamed total meaningless.
     *
     *   Σ value(available) = 3 × $1 floor + distributable × 60 / 70
     */
    expect(got(values, "b")).toBe(1);
    expect(got(values, "c")).toBe(1);
    expect(diagnostics.supply).toBeCloseTo(70, 10);
    expect(total(values)).toBeCloseTo(3 * 1 + (diagnostics.distributable * 60) / 70, 6);
    expect(total(values)).toBeLessThanOrEqual(diagnostics.pool);
  });

  test("001 AC7 — a row at or below replacement gets the floor, never a negative dollar", () => {
    const { values } = allocateFaab({
      availableVorp: new Map([
        ["a", 60],
        ["d", -5],
      ]),
      rosteredVorpByTeam: [10],
      pool: 100,
      floor: 1,
      chopsRemaining: 0,
    });

    expect(got(values, "d")).toBe(1);
    expect(got(values, "a")).toBeGreaterThan(1);
  });

  test("REG 2026-09-18 — the floor is reserved out of the pool before the rest is distributed", () => {
    // The reading of "pool − reserve" taken here: the reserve is the floor every
    // available row is guaranteed, so the distributable share is what is left after
    // paying it. Without reserving it, the printed dollars exceed the pool — which is
    // exactly how a 2026 board totalled $6,526 against $3,600.
    const availableVorp = new Map([
      ["a", 60],
      ["b", 0],
      ["c", 0],
    ]);

    const { diagnostics } = allocateFaab({
      availableVorp,
      rosteredVorpByTeam: [10],
      pool: 100,
      floor: 1,
      chopsRemaining: 1,
    });

    // 3 available rows × $1 floor = $3 reserved; 100 − 3 = 97 distributable.
    expect(diagnostics.distributable).toBeCloseTo(97, 10);
    expect(diagnostics.dollarsPerVorp).toBeCloseTo(97 / 70, 10);
  });

  test("001 AC7 — the diagnostics state the economy the price came from", () => {
    const { diagnostics } = allocateFaab({
      availableVorp: AVAILABLE,
      rosteredVorpByTeam: ROSTERED,
      pool: 1000,
      floor: 0,
      chopsRemaining: 2,
    });

    expect(diagnostics.pool).toBe(1000);
    expect(diagnostics.availableVorp).toBeCloseTo(100, 10); // 60 + 30 + 10
    expect(diagnostics.rosteredVorpPerTeam).toBeCloseTo(120, 10); // (200 + 100 + 60) / 3
    expect(diagnostics.chopsRemaining).toBe(2);
    expect(diagnostics.supply).toBeCloseTo(340, 10); // 100 + 2 × 120
    expect(diagnostics.distributable).toBeCloseTo(1000, 10); // no floor to reserve
    expect(diagnostics.dollarsPerVorp).toBeCloseTo(1000 / 340, 10);
  });

  test("001 AC8 — the same inputs produce the same values twice", () => {
    const args = {
      availableVorp: AVAILABLE,
      rosteredVorpByTeam: ROSTERED,
      pool: 1000,
      floor: 1,
      chopsRemaining: 2,
    };

    expect([...allocateFaab(args).values]).toEqual([...allocateFaab(args).values]);
  });
});

describe("a floor the room cannot pay", () => {
  test("001 AC7 — a reserve larger than the pool is refused, not turned into negative prices", () => {
    // The live week-2 shape: 4,137 available players, $13,701 in the room. At a $5
    // minimum bid the reserve is $20,685 — more than the pool — and an unguarded
    // subtraction prices the best player at −$13.90 while the board still "closes".
    const availableVorp = new Map(
      Array.from({ length: 4137 }, (_, i) => [`p${i}`, i === 0 ? 9.2 : 0] as const),
    );

    const call = (): unknown =>
      allocateFaab({
        availableVorp,
        rosteredVorpByTeam: [241],
        pool: 13701,
        floor: 5,
        chopsRemaining: 14,
      });

    expect(call).toThrow(/reserve|floor|pool/i);
  });

  test("001 AC7 — no price is ever negative, whatever the floor", () => {
    const { values } = allocateFaab({
      availableVorp: new Map([
        ["a", 60],
        ["b", 0],
      ]),
      rosteredVorpByTeam: [10],
      pool: 100,
      floor: 1,
      chopsRemaining: 1,
    });

    for (const value of values.values()) {
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});

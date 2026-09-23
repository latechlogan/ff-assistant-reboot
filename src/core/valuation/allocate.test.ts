/**
 * Interface assumed by 007's tests (tickets/007, written before the implementation):
 *
 *   allocateFaab(args) gains one optional argument, `guillotine`. Absent, the function
 *   behaves exactly as before (no leakage; `chopsRemaining` whole rosters). Present:
 *     guillotine: {
 *       fromWeek: number;                  // the week being priced
 *       survivalWeights: readonly number[]; // index 0 = fromWeek, one per priced week
 *       chopWeeks: readonly number[];      // absolute week of EVERY chop still ahead,
 *                                          // one entry per chop (a week repeats at 2/wk)
 *       budget: number;                    // each team's season FAAB budget
 *       curve: UnspentCurve;
 *     }
 *   UnspentCurve (the parsed subset of measured/chop-unspent-v1.json):
 *     { byChopWeek: readonly { week: number; mean: number }[];
 *       survivorResidual: { mean: number } }
 *   With `guillotine`, a chop in week j releases a roster counted at
 *   Σ weights after j ÷ Σ all weights (so the final chop's release counts 0), and
 *   leakage = budget × (Σ over chopWeeks of that week's mean + survivorResidual.mean).
 *
 *   diagnostics gains three fields (present with or without `guillotine`):
 *     leakage: number             // 0 without `guillotine`
 *     reserve: number             // floor × priced rows
 *     releaseEquivalents: number  // Σ of the release weights above
 *   and `distributable` becomes pool − leakage − reserve; `pool` stays gross.
 *
 *   Errors: throws when a chopWeek has no byChopWeek entry, naming it ("week 9");
 *   throws when the reserve ≥ pool − leakage (the existing reserve guard, now net).
 */
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

/**
 * Ticket 007 — the guillotine economy over time. Both halves of `pool ÷ supply`.
 *
 * "The week-3 inputs" are the frozen week-3 board's own aggregates, copied here because
 * the data repo is private. Each value names where it came from:
 *   ../ff-assistant-data/boards/2026/wk03-chopped.json
 *     diagnostics.economy.availableVorp        205.61152857142855
 *     diagnostics.economy.rosteredVorpPerTeam  199.9318806122449
 *     diagnostics.economy.chopsRemaining       12 (releases)
 *     diagnostics.economy.pool                 12701
 *     diagnostics.survivalWeights              13 weights, weeks 3–15
 *     diagnostics.week / throughWeek           3 / 15 → 13 chops, weeks 3–15
 *     rows[name = "Breece Hall"].vorp           43.335428571428565
 *   the league's waiver_budget (tickets/007, "the week-3 inputs")  $1,000
 *   ../ff-assistant-data/measured/chop-unspent-v1.json
 *     byChopWeek[].mean, survivorResidual.mean  (UNSPENT_CURVE below)
 * The room bids from $0, so the floor is 0.
 */
const W3 = {
  availableVorp: 205.61152857142855,
  rosteredVorpPerTeam: 199.9318806122449,
  releases: 12,
  pool: 12701,
  budget: 1000,
  hallVorp: 43.335428571428565,
  survivalWeights: [
    1, 0.9285714285714286, 0.8571428571428572, 0.7857142857142857, 0.7142857142857143,
    0.6428571428571429, 0.5714285714285714, 0.5, 0.42857142857142855, 0.35714285714285715,
    0.28571428571428575, 0.2142857142857143, 0.14285714285714285,
  ],
  chopWeeks: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
} as const;

/** measured/chop-unspent-v1.json: byChopWeek[].mean (weeks 1–17) and survivorResidual.mean. */
const UNSPENT_CURVE = {
  byChopWeek: [
    { week: 1, mean: 0.9998 },
    { week: 2, mean: 0.9578 },
    { week: 3, mean: 0.7777 },
    { week: 4, mean: 0.7453 },
    { week: 5, mean: 0.721 },
    { week: 6, mean: 0.673 },
    { week: 7, mean: 0.471 },
    { week: 8, mean: 0.2253 },
    { week: 9, mean: 0.2265 },
    { week: 10, mean: 0.1703 },
    { week: 11, mean: 0.1316 },
    { week: 12, mean: 0.0442 },
    { week: 13, mean: 0.1025 },
    { week: 14, mean: 0.0252 },
    { week: 15, mean: 0.0228 },
    { week: 16, mean: 0.02 },
    { week: 17, mean: 0.0075 },
  ],
  survivorResidual: { mean: 0.0182 },
};

/** The same weeks with nothing unspent anywhere: the supply half with no money half. */
const NOTHING_LEAKS = {
  byChopWeek: UNSPENT_CURVE.byChopWeek.map(({ week }) => ({ week, mean: 0 })),
  survivorResidual: { mean: 0 },
};

/**
 * The week-3 room as allocateFaab sees it. Hall is one available row; the rest of the
 * available VORP is a second row, so Σ VORP(available) is the board's own 205.61.
 * One rostered entry at the board's mean per live team gives that mean exactly.
 */
function week3(
  overrides: { curve?: typeof UNSPENT_CURVE; guillotine?: boolean; pool?: number } = {},
) {
  const base = {
    availableVorp: new Map([
      ["hall", W3.hallVorp],
      ["rest", W3.availableVorp - W3.hallVorp],
    ]),
    rosteredVorpByTeam: [W3.rosteredVorpPerTeam],
    pool: overrides.pool ?? W3.pool,
    floor: 0,
    chopsRemaining: W3.releases,
  };
  if (overrides.guillotine === false) return allocateFaab(base);
  return allocateFaab({
    ...base,
    guillotine: {
      fromWeek: 3,
      survivalWeights: W3.survivalWeights,
      chopWeeks: W3.chopWeeks,
      budget: W3.budget,
      curve: overrides.curve ?? UNSPENT_CURVE,
    },
  });
}

describe("007 — the supply: a release is worth only the weeks left after its chop", () => {
  test("007 AC1 — a release after week j counts the survival-weighted share of points left after j", () => {
    /**
     * Hand-built: priced weeks 5, 6, 7 with weights 1, 0.5, 0.25 (Σ = 1.75), one chop
     * after each. The release after week 5 has weeks 6–7 left: 0.75 / 1.75. After week
     * 6, week 7 alone: 0.25 / 1.75. After week 7, nothing: 0. Total 1 / 1.75 roster.
     * Nothing leaks, so only the supply side moves.
     */
    const { diagnostics } = allocateFaab({
      availableVorp: new Map([["a", 10]]),
      rosteredVorpByTeam: [70],
      pool: 1000,
      floor: 0,
      chopsRemaining: 2,
      guillotine: {
        fromWeek: 5,
        survivalWeights: [1, 0.5, 0.25],
        chopWeeks: [5, 6, 7],
        budget: 100,
        curve: NOTHING_LEAKS,
      },
    });

    expect(diagnostics.releaseEquivalents).toBeCloseTo(1 / 1.75, 10);
    // supply = 10 + (1 / 1.75) × 70 = 50, not 10 + 2 × 70 = 150.
    expect(diagnostics.supply).toBeCloseTo(50, 10);
    expect(diagnostics.dollarsPerVorp).toBeCloseTo(1000 / 50, 10);
  });

  test("007 AC1 — on the week-3 inputs the 12 releases are 4.25 roster-equivalents, not 12", () => {
    const { diagnostics } = week3();

    expect(Math.abs(diagnostics.releaseEquivalents - 4.25)).toBeLessThanOrEqual(0.01);
    // And the supply is built from them: 205.61 + 4.25 × 199.93 = 1055.32 (was 2605).
    expect(diagnostics.supply).toBeCloseTo(
      W3.availableVorp + diagnostics.releaseEquivalents * W3.rosteredVorpPerTeam,
      6,
    );
    expect(Math.abs(diagnostics.supply - 1055)).toBeLessThan(1);
  });
});

describe("007 — the pool: only the money that will actually be spent", () => {
  test("007 AC2 — leakage is each remaining chop's mean unspent share of a budget, plus the survivor's residual", () => {
    /**
     * Hand-built: three chops still ahead, two of them in week 4 (a two-a-week room).
     * Each chop counts, so week 4 counts twice:
     *   budget 200 × (0.5 + 0.25 + 0.25 + 0.1 survivor) = 200 × 1.1 = 220.
     */
    const curve = {
      byChopWeek: [
        { week: 3, mean: 0.5 },
        { week: 4, mean: 0.25 },
      ],
      survivorResidual: { mean: 0.1 },
    };
    const { diagnostics } = allocateFaab({
      availableVorp: new Map([["a", 10]]),
      rosteredVorpByTeam: [10],
      pool: 1000,
      floor: 0,
      chopsRemaining: 2,
      guillotine: {
        fromWeek: 3,
        survivalWeights: [1, 0.5],
        chopWeeks: [3, 4, 4],
        budget: 200,
        curve,
      },
    });

    expect(diagnostics.pool).toBe(1000); // gross: the room's FAAB, untouched
    expect(diagnostics.leakage).toBeCloseTo(220, 10);
    expect(diagnostics.distributable).toBeCloseTo(780, 10);
  });

  test("007 AC2 — on the week-3 inputs the spendable pool is $8,346 of $12,701, and both are stated", () => {
    const { diagnostics } = week3();

    /**
     * 13 chops in weeks 3–15: Σ mean = 4.3364 → $4,336.40; survivor 0.0182 → $18.20.
     * Leakage $4,354.60; $12,701 − $4,354.60 = $8,346.40.
     */
    expect(diagnostics.pool).toBe(12701);
    expect(diagnostics.leakage).toBeGreaterThan(0);
    expect(Math.abs(diagnostics.pool - diagnostics.leakage - 8346)).toBeLessThanOrEqual(5);
    // No floor in this room, so nothing is reserved and the spendable pool is distributed.
    expect(diagnostics.distributable).toBeCloseTo(diagnostics.pool - diagnostics.leakage, 6);
  });
});

describe("007 — the curve must be there for every chop ahead", () => {
  test("007 AC3 — a chop week the curve has no entry for is refused, never defaulted", () => {
    const gap = {
      ...UNSPENT_CURVE,
      byChopWeek: UNSPENT_CURVE.byChopWeek.filter(({ week }) => week !== 9),
    };

    expect(() => week3({ curve: gap })).toThrow(/week 9\b/i);
  });

  test("007 AC3 — weeks the room has already passed may be missing: only chops ahead need an entry", () => {
    // The week-3 room's chops are weeks 3–15; a curve without weeks 1–2 or 16–17 is enough.
    const onlyAhead = {
      ...UNSPENT_CURVE,
      byChopWeek: UNSPENT_CURVE.byChopWeek.filter(({ week }) => week >= 3 && week <= 15),
    };

    expect(week3({ curve: onlyAhead }).diagnostics.leakage).toBeCloseTo(
      week3().diagnostics.leakage,
      10,
    );
  });
});

describe("007 — the reserve comes out of the spendable pool", () => {
  test("007 AC4 — distributable = pool − leakage − reserve, with each recorded", () => {
    // $1 floor over 2 available rows reserves $2. One chop in week 3 at 0.5 of a $100
    // budget, no survivor residual: leakage $50. 200 − 50 − 2 = 148.
    const { diagnostics } = allocateFaab({
      availableVorp: new Map([
        ["a", 30],
        ["b", 0],
      ]),
      rosteredVorpByTeam: [10],
      pool: 200,
      floor: 1,
      chopsRemaining: 0,
      guillotine: {
        fromWeek: 3,
        survivalWeights: [1],
        chopWeeks: [3],
        budget: 100,
        curve: { byChopWeek: [{ week: 3, mean: 0.5 }], survivorResidual: { mean: 0 } },
      },
    });

    expect(diagnostics.pool).toBe(200);
    expect(diagnostics.leakage).toBeCloseTo(50, 10);
    expect(diagnostics.reserve).toBeCloseTo(2, 10);
    expect(diagnostics.distributable).toBeCloseTo(148, 10);
  });

  test("007 AC4 — a reserve the spendable pool cannot pay is refused, even when the gross pool could", () => {
    // 60 rows at a $1 floor reserve $60: under the $100 gross pool, over the $50 left
    // once a week-3 chop takes half of a $100 budget with it.
    const call = (): unknown =>
      allocateFaab({
        availableVorp: new Map(Array.from({ length: 60 }, (_, i) => [`p${i}`, i === 0 ? 5 : 0])),
        rosteredVorpByTeam: [10],
        pool: 100,
        floor: 1,
        chopsRemaining: 0,
        guillotine: {
          fromWeek: 3,
          survivalWeights: [1],
          chopWeeks: [3],
          budget: 100,
          curve: { byChopWeek: [{ week: 3, mean: 0.5 }], survivorResidual: { mean: 0 } },
        },
      });

    expect(call).toThrow(/reserve|floor|pool/i);
  });
});

describe("007 — both halves, and never one", () => {
  const within = (x: number, target: number, tolerance: number): boolean =>
    Math.abs(x - target) <= tolerance;
  const hall = (values: ReadonlyMap<string, number>): number => got(values, "hall");

  test("007 AC5 — on the week-3 inputs $/VORP is 7.91 and Hall is $343", () => {
    const { values, diagnostics } = week3();

    expect(within(diagnostics.dollarsPerVorp, 7.91, 0.02)).toBe(true);
    expect(within(hall(values), 343, 2)).toBe(true);
  });

  test("007 AC5 — the supply half alone misses both: $/VORP ~12.0, Hall ~$521", () => {
    // Time-weighted releases, but a curve under which nothing leaks.
    const { values, diagnostics } = week3({ curve: NOTHING_LEAKS });

    expect(diagnostics.leakage).toBe(0);
    expect(within(diagnostics.dollarsPerVorp, 7.91, 0.02)).toBe(false);
    expect(within(hall(values), 343, 2)).toBe(false);
    // Overshoot, not a near miss.
    expect(diagnostics.dollarsPerVorp).toBeGreaterThan(11.5);
  });

  test("007 AC5 — the pool half alone misses both: $/VORP ~3.2, Hall ~$139", () => {
    // Whole-roster releases (no guillotine timing), but the pool net of the leakage the
    // full model deducts.
    const leakage = week3().diagnostics.leakage;
    expect(leakage).toBeGreaterThan(0); // or this is just today's board again

    const { values, diagnostics } = week3({ guillotine: false, pool: W3.pool - leakage });

    expect(within(diagnostics.dollarsPerVorp, 7.91, 0.02)).toBe(false);
    expect(within(hall(values), 343, 2)).toBe(false);
    expect(diagnostics.dollarsPerVorp).toBeLessThan(3.5);
  });

  test("007 AC5 — the inputs reproduce the frozen pre-007 board ($/VORP 4.88, Hall $211), which misses both", () => {
    const { values, diagnostics } = week3({ guillotine: false });

    expect(diagnostics.dollarsPerVorp).toBeCloseTo(4.876009209289164, 6); // the frozen board's
    expect(within(diagnostics.dollarsPerVorp, 7.91, 0.02)).toBe(false);
    expect(within(hall(values), 343, 2)).toBe(false);
  });
});

/**
 * Spread the league's remaining FAAB over the VORP the rest of the season will release.
 *
 * FAAB is season currency and every future chop releases a roster, so the supply a
 * dollar is competing for is not just this week's pool:
 *
 *     supply        = Σ VORP(available) + releaseEquivalents × mean VORP rostered per live team
 *     distributable = pool − leakage − reserve
 *     value_i       = floor + VORP_i × distributable / supply
 *
 * Pricing this week's players over the whole pool inflates every row — in 2026 it put
 * the top waiver player at $3,578 of a $15,000 pool. The reserve is the floor every
 * available row is guaranteed, taken out before the rest is distributed, so the
 * printed dollars never exceed the pool.
 *
 * In a guillotine room both sides of that ratio move with time (tickets/007), and the
 * two corrections ship together because each alone overshoots the other way:
 *
 *   - supply: a roster released by the chop after week j is only usable for the weeks
 *     left after j, so it counts Σ weights after j ÷ Σ all weights of a roster — the
 *     survival curve the model already has, nothing new. The final chop's release
 *     counts 0. Without a guillotine, `chopsRemaining` whole rosters, as before.
 *   - pool: a chopped team leaves with its unspent FAAB, and the survivor never spends
 *     its last few dollars. That money never buys a player, so `leakage` — the measured
 *     mean unspent share of a budget for each chop week ahead, plus the survivor's
 *     residual — comes out of the pool before anything is priced.
 *
 * The unspent curve is MEASURED (2025, 23 rooms; ../ff-assistant-data/measured/
 * chop-unspent-v1.json), never a literal here. Its caveats travel with it: one season,
 * a self-selected sample, 16-24 chops per week, FAAB trades netted in. It is a prior to
 * be re-measured from our own room as the season runs, not a constant.
 *
 * Known and not modelled: the chopped team is the week's lowest scorer, so its roster
 * is probably worth less than the mean roster. Measuring that needs rosters at chop
 * time, which the 2025 crawl did not keep.
 */

/** The measured curve, as much of chop-unspent-v1.json as pricing reads. */
export type UnspentCurve = {
  /** Mean share of a team's season budget still unspent when it is chopped in `week`. */
  readonly byChopWeek: readonly { readonly week: number; readonly mean: number }[];
  /** Mean share of a budget the survivor ends the season holding. */
  readonly survivorResidual: { readonly mean: number };
};

export type Allocation = {
  readonly values: ReadonlyMap<string, number>;
  readonly diagnostics: {
    /** The room's FAAB, gross — every live team's remaining budget. */
    readonly pool: number;
    /** FAAB expected to leave the room unspent: chopped teams' and the survivor's. */
    readonly leakage: number;
    /** The floor every available row is guaranteed, paid from the spendable pool. */
    readonly reserve: number;
    /** pool − leakage − reserve: what is spread over the supply. */
    readonly distributable: number;
    readonly availableVorp: number;
    readonly rosteredVorpPerTeam: number;
    /**
     * Releases still worth buying: chops whose roster has at least one week left to
     * play (guillotine — the final chop's does not), or whole-roster releases otherwise.
     */
    readonly chopsRemaining: number;
    /** The releases' worth in whole rosters, after weighting each by the weeks it has left. */
    readonly releaseEquivalents: number;
    readonly supply: number;
    readonly dollarsPerVorp: number;
  };
};

export function allocateFaab(args: {
  /** VORP for the available players being priced. */
  availableVorp: ReadonlyMap<string, number>;
  /** Σ VORP held by each live roster, one entry per live team. */
  rosteredVorpByTeam: readonly number[];
  pool: number;
  floor: number;
  /** Whole rosters still to be released. Ignored when `guillotine` is given. */
  chopsRemaining: number;
  /** A guillotine room's timing. Absent, releases are whole rosters and nothing leaks. */
  guillotine?: {
    /** The week being priced; `survivalWeights[0]` is this week's. */
    fromWeek: number;
    survivalWeights: readonly number[];
    /** The week of every chop still ahead, one entry per chop. */
    chopWeeks: readonly number[];
    /** Each team's season FAAB budget, the unit the curve's shares are measured in. */
    budget: number;
    curve: UnspentCurve;
  };
}): Allocation {
  const { availableVorp, rosteredVorpByTeam, pool, floor, guillotine } = args;

  // A row below replacement is worth the floor and nothing more; it never subtracts
  // from what everyone else is worth.
  const contribution = new Map([...availableVorp].map(([id, v]) => [id, Math.max(0, v)]));
  const availableTotal = [...contribution.values()].reduce((sum, v) => sum + v, 0);

  const rosteredPerTeam =
    rosteredVorpByTeam.length === 0
      ? 0
      : rosteredVorpByTeam.reduce((sum, v) => sum + v, 0) / rosteredVorpByTeam.length;

  const lastWeek = guillotine ? guillotine.fromWeek + guillotine.survivalWeights.length - 1 : 0;
  const chopsRemaining = guillotine
    ? guillotine.chopWeeks.filter((week) => week < lastWeek).length
    : args.chopsRemaining;
  const releaseEquivalents = guillotine ? timeWeightedReleases(guillotine) : chopsRemaining;
  const leakage = guillotine ? expectedLeakage(guillotine) : 0;

  const supply = availableTotal + releaseEquivalents * rosteredPerTeam;
  const spendable = pool - leakage;
  const reserve = floor * contribution.size;

  // Deliberately not handled (Logan, 2026-09-22): the curve's shares are of a full
  // budget, so late in a season the expected leakage can exceed what the room actually
  // has left. What to price then is decided when it is near; until then, say what
  // happened rather than let the floor check below blame the floor.
  if (spendable <= 0) {
    throw new Error(
      `expected leakage of ${leakage.toFixed(0)} exceeds the room's remaining ${pool}: the ` +
        `measured unspent shares no longer fit this room. Undecided on purpose — see ` +
        `tickets/007.`,
    );
  }

  // A floor is only affordable if the room can actually pay it to every available
  // player. Mid-season the pool is a fraction of a draft budget while the available
  // list runs to thousands, so `floor × rows` can exceed it — and an unguarded
  // subtraction then makes `distributable` negative and prices the BEST player at
  // minus dollars. Refuse instead: the 2026 tool reached the same conclusion from the
  // other direction and threw on any positive minimum bid, because floor × slots is
  // the wrong mid-season reserve and nobody has designed the right one. The reserve is
  // paid from the SPENDABLE pool: floor bids are money that is actually spent.
  if (reserve >= spendable) {
    throw new Error(
      `a floor of ${floor} over ${contribution.size} available players reserves ${reserve}, ` +
        `which the spendable pool of ${spendable.toFixed(0)} (of ${pool}) cannot pay. The ` +
        `right mid-season reserve has not been designed — see DECISIONS.md and tickets/003.`,
    );
  }

  const distributable = spendable - reserve;
  const dollarsPerVorp = supply > 0 ? distributable / supply : 0;

  const values = new Map<string, number>(
    [...contribution].map(([id, v]) => [id, floor + v * dollarsPerVorp]),
  );

  return {
    values,
    diagnostics: {
      pool,
      leakage,
      reserve,
      distributable,
      availableVorp: availableTotal,
      rosteredVorpPerTeam: rosteredPerTeam,
      chopsRemaining,
      releaseEquivalents,
      supply,
      dollarsPerVorp,
    },
  };
}

/**
 * Each chop's release, counted at the share of the season's survival-weighted weeks
 * left after it: a roster freed after week j plays weeks j+1 onward and no earlier.
 */
function timeWeightedReleases(g: {
  fromWeek: number;
  survivalWeights: readonly number[];
  chopWeeks: readonly number[];
}): number {
  const total = g.survivalWeights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return 0;

  const after = (week: number): number =>
    g.survivalWeights.reduce((sum, w, i) => (g.fromWeek + i > week ? sum + w : sum), 0);

  return g.chopWeeks.reduce((sum, week) => sum + after(week) / total, 0);
}

/**
 * FAAB expected to leave unspent: for each chop ahead, the curve's mean unspent share
 * of a budget in that week, plus the survivor's residual. A chop week the curve has no
 * entry for is refused — a default here would be an invented number.
 */
function expectedLeakage(g: {
  chopWeeks: readonly number[];
  budget: number;
  curve: UnspentCurve;
}): number {
  const meanFor = new Map(g.curve.byChopWeek.map(({ week, mean }) => [week, mean]));

  const shares = g.chopWeeks.map((week) => {
    const mean = meanFor.get(week);
    if (mean === undefined) {
      throw new Error(
        `the unspent curve has no entry for a chop in week ${week}, and this room still ` +
          `has one ahead. Refusing to price rather than guess what leaves with that team.`,
      );
    }
    return mean;
  });

  return g.budget * (shares.reduce((sum, s) => sum + s, 0) + g.curve.survivorResidual.mean);
}

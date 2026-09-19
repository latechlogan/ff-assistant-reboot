/**
 * Spread the league's remaining FAAB over the VORP the rest of the season will release.
 *
 * FAAB is season currency and every future chop releases a whole roster, so the supply
 * a dollar is competing for is not just this week's pool:
 *
 *     supply  = Σ VORP(available) + chopsRemaining × mean VORP rostered per live team
 *     value_i = floor + VORP_i × (pool − reserve) / supply
 *
 * Pricing this week's players over the whole pool inflates every row — in 2026 it put
 * the top waiver player at $3,578 of a $15,000 pool. The reserve is the floor every
 * available row is guaranteed, taken out before the rest is distributed, so the
 * printed dollars never exceed the pool.
 */
export type Allocation = {
  readonly values: ReadonlyMap<string, number>;
  readonly diagnostics: {
    readonly pool: number;
    readonly distributable: number;
    readonly availableVorp: number;
    readonly rosteredVorpPerTeam: number;
    readonly chopsRemaining: number;
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
  chopsRemaining: number;
}): Allocation {
  const { availableVorp, rosteredVorpByTeam, pool, floor, chopsRemaining } = args;

  // A row below replacement is worth the floor and nothing more; it never subtracts
  // from what everyone else is worth.
  const contribution = new Map([...availableVorp].map(([id, v]) => [id, Math.max(0, v)]));
  const availableTotal = [...contribution.values()].reduce((sum, v) => sum + v, 0);

  const rosteredPerTeam =
    rosteredVorpByTeam.length === 0
      ? 0
      : rosteredVorpByTeam.reduce((sum, v) => sum + v, 0) / rosteredVorpByTeam.length;

  const supply = availableTotal + chopsRemaining * rosteredPerTeam;
  const reserve = floor * contribution.size;
  const distributable = pool - reserve;
  const dollarsPerVorp = supply > 0 ? distributable / supply : 0;

  const values = new Map<string, number>(
    [...contribution].map(([id, v]) => [id, floor + v * dollarsPerVorp]),
  );

  return {
    values,
    diagnostics: {
      pool,
      distributable,
      availableVorp: availableTotal,
      rosteredVorpPerTeam: rosteredPerTeam,
      chopsRemaining,
      supply,
      dollarsPerVorp,
    },
  };
}

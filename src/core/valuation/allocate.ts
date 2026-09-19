/**
 * Spread the league's remaining FAAB over the VORP the rest of the season will release.
 *
 * Contract:
 *  - The supply is not just this week's pool. FAAB is season currency and every future
 *    chop releases a whole roster, so:
 *        supply  = Σ VORP(available) + chopsRemaining × mean VORP rostered per live team
 *    Pricing only this week's available players over the whole pool inflates every row
 *    (measured in 2026: the top waiver player priced at $3,578 of a $15,000 pool).
 *  - value_i = floor + VORP_i × (pool − reserve) / supply, for available players only.
 *  - The identity that must hold, and must be asserted over the NAMED population:
 *        Σ value(available rows) == pool × Σ VORP(available) / supply
 *    Summing value over every player in the league is meaningless — floor-priced
 *    players make it exceed the pool.
 *  - `chopsRemaining` is a fact about the format (liveTeams − 1 in a guillotine),
 *    passed in, never inferred from a calendar.
 *  - A player with VORP 0 or less receives the floor, never a negative dollar value.
 *  - With no currency (rolling waivers), this is not called at all: an invented pool
 *    is exactly what the standing cautions forbid.
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

export function allocateFaab(_args: {
  /** VORP for the available players being priced. */
  availableVorp: ReadonlyMap<string, number>;
  /** Σ VORP held by each live roster, one entry per live team. */
  rosteredVorpByTeam: readonly number[];
  pool: number;
  floor: number;
  chopsRemaining: number;
}): Allocation {
  throw new Error("not implemented");
}

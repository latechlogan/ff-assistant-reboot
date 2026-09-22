/**
 * Score one raw stat line under one league's scoring settings.
 *
 * points = Σ (stat value × that league's weight for it). Two families of field are
 * never read, however the payload weights them:
 *
 *  - `pts_*` — the feed's own scoring, computed for 4-point passing TDs. Both of
 *    Logan's leagues score 6, which is the reason this whole pipeline exists.
 *  - anything with `adp` in the name — market data, not production.
 *
 * A statless row (stats holding only ADP) therefore scores exactly 0, which is how
 * Sleeper represents a bye or an inactive. `gp` gates nothing: a bye has NO `gp` key,
 * and a real row carrying `gp: 0` is still a real row.
 */
export function scoreStatLine(
  stats: Readonly<Record<string, number>>,
  scoring: Readonly<Record<string, number>>,
): number {
  let points = 0;

  for (const [stat, value] of Object.entries(stats)) {
    if (isNotProduction(stat)) continue;
    const rule = ruleFor(stat, scoring);
    if (rule === undefined) continue;
    points += value * rule.weight;
  }

  return points;
}

/**
 * The feed reports one combined made-bucket for every kick of 50 yards or more,
 * `fgm_50p`. A league that scores field goals by distance has no such rule — the
 * chopped league scores `fgm_50_59` at 5 and `fgm_60p` at 6 — so the key matches
 * nothing and every 50+ field goal is worth ZERO. That cost the week-3 board ~20% of
 * every kicker, and the K replacement level with it (ticket 008).
 *
 * The bridge is granularity translation of a stat we DO have, never fabrication of one
 * we don't: the coarse bucket scores at the league's own finer rate. It never splits
 * the bucket, so the price is that a genuine 60+ make scores 5 rather than 6 — the
 * 1-point difference between the two rules. Accepted, and stated here rather than
 * discovered later.
 *
 * `fgmiss_*` is deliberately NOT bridged: three feed keys collapsing into one `fgmiss`
 * rule is a different shape from one key covering two rules, and it needs its own
 * decision. The report below names it instead.
 */
const BRIDGED: Readonly<Record<string, string>> = { fgm_50p: "fgm_50_59" };

/**
 * The scoring rule this stat key scores through, and its weight — or `undefined` when
 * the league scores the key nowhere. The league's own rule always wins: a league that
 * sets `fgm_50p` to 0 has decided 50+ kicks are worth nothing, and the bridge must not
 * overrule it. Hence "is the key absent", never "is the weight falsy".
 *
 * The report (`scoreWeeklyRows`) asks the same question to decide what matched, so a
 * bridged key counts as matched on both sides and the diagnostic never cries wolf.
 */
export function ruleFor(
  stat: string,
  scoring: Readonly<Record<string, number>>,
): { key: string; weight: number } | undefined {
  const own = scoring[stat];
  if (own !== undefined) return { key: stat, weight: own };

  const bridged = BRIDGED[stat];
  if (bridged === undefined) return undefined;
  const weight = scoring[bridged];
  return weight === undefined ? undefined : { key: bridged, weight };
}

/**
 * Whether a stat key belongs in the unmatched-stat report at all.
 *
 * `pts_*` and the `adp` family are never scored, so naming them would be noise. `gp` is
 * bookkeeping — it is excluded from the REPORT only and still scores as an ordinary key
 * if a league ever weights it.
 */
export const isReportableStat = (stat: string): boolean => !isNotProduction(stat) && stat !== "gp";

const isNotProduction = (stat: string): boolean => stat.startsWith("pts_") || stat.includes("adp");

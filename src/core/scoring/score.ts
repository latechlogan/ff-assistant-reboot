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
    const weight = scoring[stat];
    if (weight === undefined) continue;
    points += value * weight;
  }

  return points;
}

const isNotProduction = (stat: string): boolean => stat.startsWith("pts_") || stat.includes("adp");

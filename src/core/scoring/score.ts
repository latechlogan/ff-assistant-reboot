/**
 * Score one raw stat line under one league's scoring settings.
 *
 * Contract:
 *  - points = Σ over stats of (stat value × that stat's scoring weight). A stat with
 *    no weight in the league contributes nothing.
 *  - Pre-scored fields are NEVER read. `pts_ppr`, `pts_std`, `pts_half_ppr` and any
 *    other `pts_*` are ignored even when the league happens to list a weight for
 *    them: public feeds score for 4-point passing TDs, and both of Logan's leagues
 *    score 6. This is the rule the whole pipeline exists to respect.
 *  - ADP fields (`adp_*`, `pos_adp_*`) are market data, not production, and are
 *    ignored the same way.
 *  - A statless row — no `gp`, stats holding only ADP — scores exactly 0. That is how
 *    Sleeper represents a bye or an inactive; it is NOT `gp: 0`.
 *  - Negative weights (interceptions, fumbles, missed kicks) apply as given.
 */
export function scoreStatLine(
  _stats: Readonly<Record<string, number>>,
  _scoring: Readonly<Record<string, number>>,
): number {
  throw new Error("not implemented");
}

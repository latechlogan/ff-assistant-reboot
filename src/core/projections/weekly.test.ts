import { describe, expect, test } from "vitest";
import { leagueFixture, playersFixture, projectionsFixture } from "../../../test/load-fixtures.ts";
import { buildPlayerIndex } from "../players/index-players.ts";
import type { LogLevel, Logger } from "../ports.ts";
import type { IndexedPlayer, PlayerIndex } from "../types.ts";
import {
  mergeUnmatched,
  scoreWeeklyRows,
  warnInactiveWithPoints,
  type ScoredWeek,
} from "./weekly.ts";

/**
 * Ticket 001:
 * AC10 — unmatched projection rows are logged loudly, with counts.
 *
 * The point of testing the logging and not just the counting: the rule is that a
 * dropped player is never silent, and a rule nothing enforces is a comment.
 *
 * Ticket 008 (`AC3` below, written before the implementation): the same rule with a
 * different subject. A stat key the league scores but the pipeline never counts, and a
 * scoring rule that never matches a key, are both silent drops — and one of them did
 * corrupt the K replacement level. Every run has to say so.
 */

/** A recorder, written here rather than imported: src/core may not reach an adapter. */
function recordingLogger(): Logger & {
  entries: { level: LogLevel; event: string; fields: Record<string, unknown> }[];
} {
  const entries: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
  return {
    entries,
    log: (level, event, fields = {}) => entries.push({ level, event, fields }),
  };
}

const index: PlayerIndex = new Map<string, IndexedPlayer>([
  ["known", { playerId: "known", name: "Known Player", position: "WR", team: "CIN" }],
]);

const scoring = { rec: 1, rec_yd: 0.1 };

describe("accounting for every projection row", () => {
  test("001 AC10 — an unmatched row is counted and logged as a warning, not a debug line", () => {
    const logger = recordingLogger();

    const scored = scoreWeeklyRows({
      rows: [
        { player_id: "known", week: 3, stats: { rec: 5, rec_yd: 50 } },
        { player_id: "ghost", week: 3, stats: { rec: 9, rec_yd: 99 } },
      ],
      index,
      scoring,
      logger,
    });

    expect(scored.matched).toBe(1);
    expect(scored.unmatched).toBe(1);
    expect(scored.weekly).toEqual([{ playerId: "known", week: 3, points: 10 }]); // 5 + 5.0

    const warning = logger.entries.find((entry) => entry.event === "projections.unmatched");
    expect(warning?.level).toBe("warn"); // loud at any verbosity, per the hard rule
    expect(warning?.fields["rows"]).toBe(1);
    expect(warning?.fields["sample"]).toEqual(["ghost"]);
  });

  test("001 AC10 — a clean week logs nothing, so the warning keeps its meaning", () => {
    const logger = recordingLogger();

    const scored = scoreWeeklyRows({
      rows: [{ player_id: "known", week: 3, stats: { rec: 1 } }],
      index,
      scoring,
      logger,
    });

    expect(scored.unmatched).toBe(0);
    expect(logger.entries).toHaveLength(0);
  });

  test("001 AC10 — the rows are still scored when nobody is listening", () => {
    const scored = scoreWeeklyRows({
      rows: [{ player_id: "ghost", week: 3, stats: { rec: 1 } }],
      index,
      scoring,
    });

    expect(scored.unmatched).toBe(1);
    expect(scored.weekly).toEqual([]);
  });
});

/**
 * Ticket 009's safety valve. The filter that drops `active: false` players is inert
 * today — on the 2026-09-22 as-of files, none of the 1,081 skipped players has a
 * projection row at all. But it is a standing rule, and next season's flag could
 * behave differently, so a skipped player who turns up with points must be named
 * rather than dropped. "Unmatched players log loudly" applied to a deliberate filter.
 */
describe("a skipped player who turns up with points", () => {
  /** Who `buildPlayerIndex` left out for `active: false`, id → name. */
  const inactive = new Map([
    ["retired", "Retired Star"],
    ["cut", "Cut Kicker"],
  ]);

  test("009 AC3 — a skipped inactive player with non-zero points is named at warn level, once per run", () => {
    const logger = recordingLogger();

    // Sixteen weeks are scored in one run; this player carries points in two of them.
    const week3 = scoreWeeklyRows({
      rows: [{ player_id: "retired", week: 3, stats: { rec: 5, rec_yd: 50 } }],
      index,
      scoring,
      inactive,
    });
    const week4 = scoreWeeklyRows({
      rows: [{ player_id: "retired", week: 4, stats: { rec: 2, rec_yd: 20 } }],
      index,
      scoring,
      inactive,
    });

    expect(week3.inactiveWithPoints).toEqual([
      { playerId: "retired", name: "Retired Star", week: 3, points: 10 },
    ]);

    const named = warnInactiveWithPoints(
      [...week3.inactiveWithPoints, ...week4.inactiveWithPoints],
      logger,
    );

    expect(named).toBe(1);
    const warnings = logger.entries.filter((e) => e.event === "players.inactive_with_points");
    expect(warnings).toHaveLength(1); // once per player per run, not once per week
    expect(warnings[0]?.level).toBe("warn"); // loud at any verbosity, per the hard rule
    expect(warnings[0]?.fields["playerId"]).toBe("retired");
    expect(warnings[0]?.fields["name"]).toBe("Retired Star"); // named, not just counted
    expect(warnings[0]?.fields["points"]).toBe(10); // and the points that make it matter
    expect(warnings[0]?.fields["week"]).toBe(3);
  });

  test("009 AC3 — a skipped player scoring zero says nothing, and is never counted as unmatched", () => {
    const logger = recordingLogger();

    const scored = scoreWeeklyRows({
      // A bye or an inactive arrives as ADP only, which scores exactly 0. That is the
      // shape all 1,081 skipped players have today, and it must stay silent or the
      // warning is noise nobody reads.
      rows: [
        { player_id: "cut", week: 3, stats: { adp_dd_ppr: 300 } },
        { player_id: "known", week: 3, stats: { rec: 1 } },
      ],
      index,
      scoring,
      inactive,
      logger,
    });

    expect(scored.inactiveWithPoints).toEqual([]);
    // A deliberately skipped player is accounted for, not folded into the unmatched
    // count — that count means "a player id we do not recognise", and blunting it is
    // how the week-3 bug survived a clean-looking run.
    expect(scored.unmatched).toBe(0);
    expect(warnInactiveWithPoints(scored.inactiveWithPoints, logger)).toBe(0);
    expect(logger.entries).toHaveLength(0);
  });

  test("009 AC3 — with no inactive set supplied, nothing changes", () => {
    const scored = scoreWeeklyRows({
      rows: [{ player_id: "ghost", week: 3, stats: { rec: 1 } }],
      index,
      scoring,
    });

    expect(scored.inactiveWithPoints).toEqual([]);
    expect(scored.unmatched).toBe(1);
  });
});

/**
 * Ticket 008, AC3 — every run reports, once, two lists:
 *
 *   `unmatchedRules` — the league's own scoring rules that matched no stat key in the
 *                      weeks it priced. `fgm_50_59` was on this list and nobody saw it.
 *   `unmatchedStats` — stat keys carrying a NON-ZERO value that matched no rule.
 *
 * Scoring-irrelevant feed keys (`pts_*`, `adp_*`, `pos_adp_*`, `gp`) are excluded by
 * name from `unmatchedStats`: they are market data and bookkeeping, not production, and
 * a report that always names them is a report nobody reads.
 *
 * The core's job is to produce the lists and carry them out with the scored week; the
 * CLI prints them once for the run, which is adapter wiring and tested there.
 */
describe("accounting for every stat key and every scoring rule", () => {
  test("008 AC3 — a scored week reports the rules that matched nothing and the stat keys that matched nothing", () => {
    const scored = scoreWeeklyRows({
      rows: [
        {
          player_id: "known",
          week: 3,
          stats: {
            rec: 5, // has a rule, matches → neither list
            rec_yd: 50, // has a rule, matches → neither list
            rec_tgt: 9, // non-zero, no rule → unmatchedStats
            rush_40p: 0, // no rule, but zero → reported by neither
            pts_ppr: 12.5, // excluded by name
            pts_std: 12.5, // excluded by name
            adp_dd_ppr: 999, // excluded by name
            pos_adp_dd_ppr: 44, // excluded by name
            gp: 1, // excluded by name
          },
        },
      ],
      index,
      // `rec_td` is a rule this week's rows never exercise: the case the report exists for.
      scoring: { rec: 1, rec_yd: 0.1, rec_td: 6 },
    });

    // 5 × 1 + 50 × 0.1 = 10, unchanged by any of this.
    expect(scored.weekly).toEqual([{ playerId: "known", week: 3, points: 10 }]);

    expect(scored.unmatchedRules).toEqual(["rec_td"]);
    expect(scored.unmatchedStats).toEqual(["rec_tgt"]);
  });

  test("008 AC3 — the lists are deduped and cover every week and row in the call, not just the first", () => {
    const scored = scoreWeeklyRows({
      rows: [
        { player_id: "known", week: 3, stats: { rec: 1, rec_tgt: 2 } },
        { player_id: "known", week: 4, stats: { rec_yd: 10, rec_tgt: 3, rec_fd: 1 } },
      ],
      index,
      scoring: { rec: 1, rec_yd: 0.1, rec_td: 6 },
    });

    // `rec_tgt` appears in both rows and is named once. `rec_fd` appears only in the
    // second, and a report built from `rows[0]` alone would miss it.
    expect(scored.unmatchedStats).toEqual(["rec_fd", "rec_tgt"]);
    // `rec` matched in week 3 and `rec_yd` in week 4, so neither is unmatched for the
    // call even though each matched in only one of the two weeks.
    expect(scored.unmatchedRules).toEqual(["rec_td"]);
  });

  test("008 AC3 — a bridged key counts as matched on both sides, so the report does not cry wolf", () => {
    const scored = scoreWeeklyRows({
      rows: [{ player_id: "known", week: 3, stats: { fgm_50p: 0.36 } }],
      index,
      scoring: { fgm_50_59: 5, fgm_60p: 6 },
    });

    // 0.36 × 5 = 1.8, via the bridge.
    expect(scored.weekly[0]?.points).toBeCloseTo(1.8, 10);
    // The stat scored, so it is not an unmatched stat key…
    expect(scored.unmatchedStats).toEqual([]);
    // …and the rule it scored through is not an unmatched rule. `fgm_60p` still is:
    // no feed key reaches it, which is exactly what the report is for.
    expect(scored.unmatchedRules).toEqual(["fgm_60p"]);
  });

  test("008 AC3 — with no fgm_50_59 rule to bridge to, fgm_50p is reported rather than dropped", () => {
    const scored = scoreWeeklyRows({
      rows: [{ player_id: "known", week: 3, stats: { fgm_50p: 0.36 } }],
      index,
      scoring: { fgm_0_19: 3 },
    });

    // Nothing to translate into, so it scores 0 — but loudly, not silently. Inventing
    // a rate here would be the fabrication the bridge is careful not to be.
    expect(scored.weekly[0]?.points).toBe(0);
    expect(scored.unmatchedStats).toEqual(["fgm_50p"]);
    expect(scored.unmatchedRules).toEqual(["fgm_0_19"]);
  });

  test("008 AC3 — on the fixtures the report names the fgmiss family and nothing scoring-irrelevant", () => {
    const scored = scoreWeeklyRows({
      rows: projectionsFixture().map((row) => ({
        player_id: row.player_id,
        week: row.week,
        stats: row.stats,
      })),
      index: buildPlayerIndex(playersFixture()).index,
      scoring: leagueFixture().scoring_settings,
    });

    // The ticket's own example, in the shape the fixtures carry it: the league scores a
    // generic `fgmiss` at −1 and the feed reports misses bucketed. Nobody counts them,
    // so both tools slightly overvalue kickers — deliberately out of scope here, and
    // the report is what makes that a known debt rather than an accident.
    expect(scored.unmatchedRules).toContain("fgmiss");
    expect(scored.unmatchedStats).toContain("fgmiss_30_39");
    expect(scored.unmatchedStats).toContain("fgmiss_40_49");

    // The week-2 fixture carries no `fgm_50p`, so the two long made-buckets have no key
    // to match — the silence that cost Shrader 1.8 points a week, now said out loud.
    expect(scored.unmatchedRules).toContain("fgm_50_59");
    expect(scored.unmatchedRules).toContain("fgm_60p");
    // The kicker totals the buckets already cover, and the D/ST rules no fixture row
    // exercises, land on the lists too: the report claims coverage, not relevance.
    expect(scored.unmatchedStats).toContain("fga");
    expect(scored.unmatchedRules).toContain("sack");

    // Nothing that DID score is named. `fgm_40_49` weighted 13 kicker rows; `rec_yd`
    // nearly every skill row.
    expect(scored.unmatchedRules).not.toContain("fgm_40_49");
    expect(scored.unmatchedRules).not.toContain("rec_yd");
    expect(scored.unmatchedStats).not.toContain("rec_yd");

    // Excluded by name, though every fixture row carries all five.
    for (const noise of ["pts_ppr", "pts_std", "pts_half_ppr", "adp_dd_ppr", "pos_adp_dd_ppr"]) {
      expect(scored.unmatchedStats).not.toContain(noise);
    }
    expect(scored.unmatchedStats).not.toContain("gp");

    // Zero-valued keys are not named either. `pass_int_td` and `def_fum_td` have no
    // rule in this league and appear on fixture rows only ever as 0.
    expect(scored.unmatchedStats).not.toContain("pass_int_td");
    expect(scored.unmatchedStats).not.toContain("def_fum_td");

    // Sorted and deduped, so two runs cannot print the same report in two orders.
    expect(scored.unmatchedRules).toEqual([...new Set(scored.unmatchedRules)].sort());
    expect(scored.unmatchedStats).toEqual([...new Set(scored.unmatchedStats)].sort());
  });
});

/**
 * Ticket 008, AC3 — "once per run". The CLI prices one week per as-of file and folds
 * the weeks into the single report it prints; this is that fold. Written by the
 * implementer, per docs/trust.md: it is wiring, not pricing math.
 */
describe("folding a run's weeks into one report", () => {
  const week = (over: Partial<ScoredWeek>): ScoredWeek => ({
    weekly: [],
    matched: 0,
    unmatched: 0,
    inactiveWithPoints: [],
    unmatchedRules: [],
    unmatchedStats: [],
    ...over,
  });

  test("008 AC3 — stat keys union across weeks: unmatched in any week is unmatched for the run", () => {
    const merged = mergeUnmatched([
      week({ unmatchedStats: ["fgmiss_40_49"] }),
      week({ unmatchedStats: ["fgm_50p", "fgmiss_40_49"] }),
    ]);

    // `fgm_50p` first appears in week 3. Intersecting would lose it — the exact silence
    // this ticket exists to end.
    expect(merged.unmatchedStats).toEqual(["fgm_50p", "fgmiss_40_49"]);
  });

  test("008 AC3 — rules intersect across weeks: a rule that matched anywhere is not unmatched", () => {
    const merged = mergeUnmatched([
      week({ unmatchedRules: ["fgm_60p", "fgmiss", "sack"] }),
      week({ unmatchedRules: ["fgmiss", "sack"] }), // fgm_60p matched in this week
    ]);

    // Unioning would name `fgm_60p` because ONE week's rows carried no long kick, and a
    // diagnostic that cries wolf is one nobody reads.
    expect(merged.unmatchedRules).toEqual(["fgmiss", "sack"]);
  });

  test("008 AC3 — the merged lists are sorted and deduped, so two runs print one order", () => {
    const merged = mergeUnmatched([
      week({ unmatchedRules: ["sack", "fgmiss"], unmatchedStats: ["fgmiss_50p", "fga"] }),
      week({ unmatchedRules: ["fgmiss", "sack"], unmatchedStats: ["fga"] }),
    ]);

    expect(merged.unmatchedRules).toEqual(["fgmiss", "sack"]);
    expect(merged.unmatchedStats).toEqual(["fga", "fgmiss_50p"]);
  });

  test("008 AC3 — a run with no weeks reports nothing rather than throwing", () => {
    expect(mergeUnmatched([])).toEqual({ unmatchedRules: [], unmatchedStats: [] });
  });
});

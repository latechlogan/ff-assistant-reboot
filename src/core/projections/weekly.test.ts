import { describe, expect, test } from "vitest";
import type { LogLevel, Logger } from "../ports.ts";
import type { IndexedPlayer, PlayerIndex } from "../types.ts";
import { scoreWeeklyRows, warnInactiveWithPoints } from "./weekly.ts";

/**
 * AC10 — unmatched projection rows are logged loudly, with counts.
 *
 * The point of testing the logging and not just the counting: the rule is that a
 * dropped player is never silent, and a rule nothing enforces is a comment.
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
  test("AC10 — an unmatched row is counted and logged as a warning, not a debug line", () => {
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

  test("AC10 — a clean week logs nothing, so the warning keeps its meaning", () => {
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

  test("AC10 — the rows are still scored when nobody is listening", () => {
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

  test("AC3 — a skipped inactive player with non-zero points is named at warn level, once per run", () => {
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

  test("AC3 — a skipped player scoring zero says nothing, and is never counted as unmatched", () => {
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

  test("AC3 — with no inactive set supplied, nothing changes", () => {
    const scored = scoreWeeklyRows({
      rows: [{ player_id: "ghost", week: 3, stats: { rec: 1 } }],
      index,
      scoring,
    });

    expect(scored.inactiveWithPoints).toEqual([]);
    expect(scored.unmatched).toBe(1);
  });
});

import { describe, expect, test } from "vitest";
import type { LogLevel, Logger } from "../ports.ts";
import type { IndexedPlayer, PlayerIndex } from "../types.ts";
import { scoreWeeklyRows } from "./weekly.ts";

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

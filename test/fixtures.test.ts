import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  LeagueSchema,
  NflStateSchema,
  PlayerMapSchema,
  ProjectionsSchema,
  RostersSchema,
} from "../src/adapters/sleeper/schemas.ts";

/**
 * Fixtures are trimmed real Sleeper payloads (scripts/fixtures.ts). Two things have
 * to stay true of them, and neither is obvious by looking:
 *
 *   1. They still parse against the boundary schemas — otherwise the tests below
 *      them are testing a shape Sleeper no longer sends.
 *   2. They carry no real identity. They live in a public repo.
 */

const DIR = path.resolve(import.meta.dirname, "fixtures");
const read = (name: string): unknown => JSON.parse(readFileSync(path.join(DIR, name), "utf8"));

describe("fixtures parse against the boundary schemas", () => {
  test("nfl state", () => {
    expect(NflStateSchema.safeParse(read("nfl-state.json")).success).toBe(true);
  });

  test("league", () => {
    expect(LeagueSchema.safeParse(read("league-guillotine.json")).success).toBe(true);
  });

  test("rosters", () => {
    expect(RostersSchema.safeParse(read("rosters-guillotine.json")).success).toBe(true);
  });

  test("weekly projections", () => {
    expect(ProjectionsSchema.safeParse(read("projections-week.json")).success).toBe(true);
  });

  test("player map", () => {
    expect(PlayerMapSchema.safeParse(read("players.json")).success).toBe(true);
  });
});

describe("fixtures keep the shapes that cost us in 2026", () => {
  test("a chopped roster is present, marked only by `eliminated`", () => {
    const rosters = RostersSchema.parse(read("rosters-guillotine.json"));
    const chopped = rosters.filter((r) => r.settings.eliminated != null);

    expect(chopped).toHaveLength(1);
    expect(chopped[0]?.owner_id).toBeTruthy(); // owner_id survives elimination — no signal
  });

  test("live rosters carry no `eliminated` key at all, rather than a zero", () => {
    const rosters = RostersSchema.parse(read("rosters-guillotine.json"));
    const live = rosters.filter((r) => r.settings.eliminated == null);

    expect(live.length).toBeGreaterThan(0);
    for (const roster of live) {
      expect(roster.settings).not.toHaveProperty("eliminated");
    }
  });

  test("a statless row is present: no `gp`, no `game_id`, adp only — not `gp: 0`", () => {
    const rows = ProjectionsSchema.parse(read("projections-week.json"));
    const statless = rows.filter((r) => r.stats["gp"] === undefined);

    expect(statless.length).toBeGreaterThan(0);
    const row = statless[0];
    expect(row?.game_id ?? null).toBeNull();
    expect(Object.keys(row?.stats ?? {})).toEqual(["adp_dd_ppr"]);
  });

  test("scoring carries the settings that make local scoring necessary", () => {
    const league = LeagueSchema.parse(read("league-guillotine.json"));

    expect(league.scoring_settings["pass_td"]).toBe(6); // not the public 4-pt default
    expect(league.scoring_settings["rec"]).toBe(1);
  });
});

describe("fixtures carry no real identity", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
  /**
   * Identity cannot be checked by shape: a real owner id and a rookie's public
   * player id are both 19 digits (measured 2026-09-18). So fixtures are checked
   * against the published hashes of the real identifiers — the same exact check
   * `pnpm privacy-scan` runs over the whole repo.
   */
  const hashes: Set<string> = new Set(
    (
      JSON.parse(
        readFileSync(path.resolve(import.meta.dirname, "../privacy-hashes.json"), "utf8"),
      ) as { hashes: string[] }
    ).hashes,
  );

  test.each(files)("%s contains no real league, draft or owner id", (file) => {
    const text = readFileSync(path.join(DIR, file), "utf8");

    for (const candidate of text.match(/\b\d{15,20}\b/g) ?? []) {
      expect(hashes.has(createHash("sha256").update(candidate).digest("hex"))).toBe(false);
    }
  });

  test("owner ids are obvious placeholders", () => {
    const rosters = RostersSchema.parse(read("rosters-guillotine.json"));

    for (const roster of rosters) {
      expect(roster.owner_id).toMatch(/^owner_\d{3}$/);
    }
  });
});

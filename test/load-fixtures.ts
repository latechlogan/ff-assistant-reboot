import { readFileSync } from "node:fs";
import path from "node:path";
import type { LeaguePayload } from "../src/core/config/derive.ts";
import type { PlayerPayload } from "../src/core/players/index-players.ts";
import type { RosterPayload } from "../src/core/rosters/state.ts";

/**
 * Fixture loading for the core's unit tests.
 *
 * It lives here rather than in `src/core/**\/*.test.ts` because reading a file is I/O,
 * and the core-purity rule (docs/architecture.md, enforced by dependency-cruiser)
 * forbids `node:fs` anywhere under `src/core` — test files included. Keeping the
 * reads on this side of the boundary means the core's tests stay as pure as the code
 * they test, and still run against real payloads (docs/data-model.md).
 *
 * Every accessor re-parses, so a test may mutate what it gets without leaking the
 * change into the next test.
 */

const DIR = path.resolve(import.meta.dirname, "fixtures");

function read<T>(name: string): T {
  return JSON.parse(readFileSync(path.join(DIR, name), "utf8")) as T;
}

/** One weekly projection row, as `test/fixtures/projections-week.json` holds it. */
export type ProjectionFixtureRow = {
  player_id: string;
  week: number;
  season: string;
  stats: Record<string, number>;
  game_id?: string | null;
};

export type NflStateFixture = { week: number; season: string; season_type: string };

export function leagueFixture(): LeaguePayload {
  return read<LeaguePayload>("league-guillotine.json");
}

export function rostersFixture(): RosterPayload[] {
  return read<RosterPayload[]>("rosters-guillotine.json");
}

export function playersFixture(): Record<string, PlayerPayload> {
  return read<Record<string, PlayerPayload>>("players.json");
}

export function projectionsFixture(): ProjectionFixtureRow[] {
  return read<ProjectionFixtureRow[]>("projections-week.json");
}

export function nflStateFixture(): NflStateFixture {
  return read<NflStateFixture>("nfl-state.json");
}

/** The fixture roster with this id, or a loud failure if the fixtures were retrimmed. */
export function rosterById(rosters: readonly RosterPayload[], rosterId: number): RosterPayload {
  const found = rosters.find((r) => r.roster_id === rosterId);
  if (!found) throw new Error(`fixture has no roster ${rosterId}`);
  return found;
}

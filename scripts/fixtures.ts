/**
 * Regenerates test/fixtures/ from real Sleeper payloads — trimmed and scrubbed.
 *
 * Why real payloads (docs/trust.md): every expensive lesson of 2026 came from the
 * feed's actual shape — byes with no `gp` field at all, chopped rosters as
 * `players: null` with `eliminated` present only when chopped, rosters holding more
 * players than the roster shape allows. A hand-written fixture encodes what we
 * believe; a trimmed real one encodes what Sleeper does.
 *
 * Why scrubbed (docs/data-model.md): fixtures live in a PUBLIC repo. Owner ids,
 * league ids and display names are replaced with obvious fakes. NFL player names and
 * ids stay — they are public figures, and name-matching tests are worthless without
 * them.
 *
 *   pnpm fixtures            # use payloads already in DATA_ROOT
 *   pnpm fixtures --refresh  # fetch fresh ones first
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Store } from "../src/adapters/store/store.ts";
import { SleeperClient } from "../src/adapters/sleeper/client.ts";
import { SleeperSource } from "../src/adapters/sleeper/sleeper.ts";
import { createLogger } from "../src/adapters/obs/logger.ts";
import type { Player, ProjectionRow, Roster } from "../src/adapters/sleeper/schemas.ts";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../test/fixtures");
/** Fake ids are unmistakable on sight and by the privacy scan: 9 then zeros then a counter. */
const FAKE_LEAGUE_ID = "900000000000000001";
const fakeOwner = (n: number) => `owner_${String(n).padStart(3, "0")}`;
/** Enough players to exercise replacement level at every position without a 3,000-row file. */
const PLAYERS_PER_POSITION = 12;
const POSITIONS = ["QB", "RB", "WR", "TE", "K"] as const;

const { values } = parseArgs({
  options: { refresh: { type: "boolean", default: false }, week: { type: "string" } },
});

const logger = createLogger({ debug: true });
const store = new Store();
const source = new SleeperSource(store, new SleeperClient({ logger }), logger);
const policy = { refresh: values.refresh };

const { season } = store.leagues();
const state = await source.nflState(season, policy);
const week = values.week ? Number(values.week) : state.data.week;
const chopped = store.league("chopped");

const league = await source.league(season, "chopped", chopped.leagueId, policy);
const rosters = await source.rosters(season, "chopped", chopped.leagueId, week, policy);
const projections = await source.weeklyProjections(season, week, policy);
const players = await source.playerMap(season, policy);

/** Roster ids are per-league integers and carry no identity; owner ids do. */
const ownerAlias = new Map<string, string>();
const aliasOwner = (id: string | null | undefined): string | null => {
  if (!id) return null;
  if (!ownerAlias.has(id)) ownerAlias.set(id, fakeOwner(ownerAlias.size + 1));
  return ownerAlias.get(id) ?? null;
};

/** Two live rosters and the chopped one: enough to test the pool, the union, and elimination. */
const eliminated = rosters.data.filter((r) => r.settings.eliminated === 1);
const live = rosters.data.filter((r) => r.settings.eliminated !== 1);
const keptRosters: Roster[] = [...live.slice(0, 2), ...eliminated.slice(0, 1)];

const scrubRoster = (r: Roster) => ({
  roster_id: r.roster_id,
  owner_id: aliasOwner(r.owner_id),
  league_id: FAKE_LEAGUE_ID,
  players: r.players ?? null,
  starters: r.starters ?? null,
  reserve: r.reserve ?? null,
  taxi: r.taxi ?? null,
  settings: {
    waiver_budget_used: r.settings.waiver_budget_used,
    ...(r.settings.eliminated === undefined || r.settings.eliminated === null
      ? {}
      : { eliminated: r.settings.eliminated }),
  },
});

const scrubbedLeague = {
  league_id: FAKE_LEAGUE_ID,
  name: "Fixture Guillotine League",
  season: league.data.season,
  status: league.data.status,
  total_rosters: league.data.total_rosters,
  roster_positions: league.data.roster_positions,
  scoring_settings: league.data.scoring_settings,
  settings: {
    type: league.data.settings.type,
    waiver_type: league.data.settings.waiver_type,
    waiver_budget: league.data.settings.waiver_budget,
    waiver_bid_min: league.data.settings.waiver_bid_min,
    playoff_week_start: league.data.settings.playoff_week_start,
  },
  previous_league_id: null,
};

/** A row has a real stat line iff it carries `gp`; byes and inactives carry only adp. */
const hasStatLine = (row: ProjectionRow) => row.stats["gp"] !== undefined;
const positionOf = (row: ProjectionRow) => row.player?.fantasy_positions?.[0] ?? "";

const keptIds = new Set<string>(keptRosters.flatMap((r) => r.players ?? []));
const byPosition = new Map<string, ProjectionRow[]>();
for (const row of projections.data) {
  if (!hasStatLine(row)) continue;
  const pos = positionOf(row);
  if (!POSITIONS.includes(pos as (typeof POSITIONS)[number])) continue;
  const bucket = byPosition.get(pos) ?? [];
  if (bucket.length < PLAYERS_PER_POSITION) {
    bucket.push(row);
    keptIds.add(row.player_id);
  }
  byPosition.set(pos, bucket);
}

/**
 * Keep one statless row — no `gp`, no `game_id`, stats holding only adp. That is how
 * Sleeper represents a bye (and an inactive), and assuming `gp: 0` instead is the
 * mistake the 2026 tool made. Byes only start around week 5, so out of season this
 * row is an inactive with the identical shape, which is what the parser has to survive.
 */
const statlessRow = projections.data.find((r) => !hasStatLine(r));
if (statlessRow) keptIds.add(statlessRow.player_id);
const keptProjections = projections.data.filter(
  (r) => keptIds.has(r.player_id) && (hasStatLine(r) || r === statlessRow),
);

const keptPlayers: Record<string, Player> = {};
for (const id of keptIds) {
  const player = players.data[id];
  if (player) keptPlayers[id] = player;
}

mkdirSync(FIXTURE_DIR, { recursive: true });
const write = (name: string, data: unknown) => {
  writeFileSync(path.join(FIXTURE_DIR, name), JSON.stringify(data, null, 2) + "\n");
  logger.log("info", "fixture.written", { name });
};

write("nfl-state.json", { week, season, season_type: "regular" });
write("league-guillotine.json", scrubbedLeague);
write("rosters-guillotine.json", keptRosters.map(scrubRoster));
write("projections-week.json", keptProjections);
write("players.json", keptPlayers);

logger.log("info", "fixtures.done", {
  week,
  players: Object.keys(keptPlayers).length,
  projectionRows: keptProjections.length,
  rosters: keptRosters.length,
  statlessRowIncluded: statlessRow !== undefined,
});

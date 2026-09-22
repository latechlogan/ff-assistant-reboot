import type { AsOf } from "../../core/ports.ts";
import { PRICED_POSITIONS } from "../../core/types.ts";
import type { Logger } from "../../core/ports.ts";
import type { Store } from "../store/store.ts";
import { SleeperClient } from "./client.ts";
import {
  LeagueSchema,
  NflStateSchema,
  PlayerMapSchema,
  ProjectionsSchema,
  RostersSchema,
  TransactionsSchema,
  type League,
  type Player,
  type ProjectionRow,
  type Roster,
  type Transaction,
} from "./schemas.ts";
import type { ZodType } from "zod";

/**
 * Sleeper as a source of as-of payloads.
 *
 * Every method follows one shape: use the newest file on disk unless asked to
 * refresh, and a refresh writes a NEW file rather than replacing one. Nothing here
 * expires — there is no TTL anywhere in this project, because the 2026 tool's 24h
 * expiry meant a rerun a day later silently repriced.
 */

const BASE = "https://api.sleeper.app";

export type FetchPolicy = {
  /** Fetch even when a payload is already on disk. */
  refresh?: boolean;
  /** Fail rather than fall back to an older payload — used with --refresh. */
  requireFresh?: boolean;
};

export class SleeperSource {
  private readonly store: Store;
  private readonly client: SleeperClient;
  private readonly logger: Logger | undefined;
  /** Injected so a test can pin the stamp; adapters may read the clock, the core may not. */
  private readonly now: () => string;

  constructor(
    store: Store,
    client: SleeperClient = new SleeperClient(),
    logger?: Logger,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.store = store;
    this.client = client;
    this.logger = logger;
    this.now = now;
  }

  private async load<T>(args: {
    season: string;
    kind: string;
    url: string;
    schema: ZodType<T>;
    policy: FetchPolicy;
  }): Promise<AsOf<T>> {
    const { season, kind, url, schema, policy } = args;

    if (!policy.refresh) {
      const cached = this.store.readNewestRaw<unknown>(season, kind);
      if (cached) {
        this.logger?.log("debug", "payload.cached", { kind, file: cached.file });
        return { ...cached, data: this.parse(schema, cached.data, `${kind} (${cached.file})`) };
      }
    }

    try {
      const raw = await this.client.getJson(url);
      const data = this.parse(schema, raw, `${kind} (${url})`);
      const written = this.store.writeRaw({
        season,
        kind,
        data: raw,
        source: url,
        fetchedAt: this.now(),
      });
      this.logger?.log("info", "payload.fetched", { kind, file: written.file });
      return { ...written, data };
    } catch (cause) {
      // Falling back to yesterday's payload is fine; pretending it is fresh is not.
      const cached = policy.requireFresh ? null : this.store.readNewestRaw<unknown>(season, kind);
      if (!cached) throw cause;
      this.logger?.log("warn", "payload.stale", {
        kind,
        file: cached.file,
        fetchedAt: cached.fetchedAt,
        reason: String(cause),
      });
      return { ...cached, data: this.parse(schema, cached.data, `${kind} (${cached.file})`) };
    }
  }

  private parse<T>(schema: ZodType<T>, value: unknown, what: string): T {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `Sleeper payload did not match the expected shape: ${what}\n${parsed.error.message}`,
      );
    }
    return parsed.data;
  }

  nflState(
    season: string,
    policy: FetchPolicy = {},
  ): Promise<AsOf<{ week: number; season: string }>> {
    return this.load({
      season,
      kind: "nfl-state",
      url: `${BASE}/v1/state/nfl`,
      schema: NflStateSchema,
      policy,
    });
  }

  league(
    season: string,
    leagueKey: string,
    leagueId: string,
    policy: FetchPolicy = {},
  ): Promise<AsOf<League>> {
    return this.load({
      season,
      kind: `league-${leagueKey}`,
      url: `${BASE}/v1/league/${leagueId}`,
      schema: LeagueSchema,
      policy,
    });
  }

  rosters(
    season: string,
    leagueKey: string,
    leagueId: string,
    week: number,
    policy: FetchPolicy = {},
  ): Promise<AsOf<Roster[]>> {
    return this.load({
      season,
      kind: `rosters-${leagueKey}-wk${String(week).padStart(2, "0")}`,
      url: `${BASE}/v1/league/${leagueId}/rosters`,
      schema: RostersSchema,
      policy,
    });
  }

  /**
   * A league week's transactions. Read to answer one question today — have this
   * week's waivers already run? (tickets/004, AC6) — and the same payload is what the
   * measured bid range will be built from later.
   *
   * Worth knowing when calling it: this is the one payload whose AGE changes the
   * answer. A cached copy pulled before the waiver run says "not cleared" forever, so
   * the guard asks for it fresh (`refresh`, `requireFresh`) and fails rather than fall
   * back. Every other payload here is happy to be yesterday's.
   */
  transactions(
    season: string,
    leagueKey: string,
    leagueId: string,
    week: number,
    policy: FetchPolicy = {},
  ): Promise<AsOf<Transaction[]>> {
    return this.load({
      season,
      kind: `transactions-${leagueKey}-wk${String(week).padStart(2, "0")}`,
      url: `${BASE}/v1/league/${leagueId}/transactions/${week}`,
      schema: TransactionsSchema,
      policy,
    });
  }

  weeklyProjections(
    season: string,
    week: number,
    policy: FetchPolicy = {},
  ): Promise<AsOf<ProjectionRow[]>> {
    // The taxonomy has one home: the core decides what this project prices.
    const positions = PRICED_POSITIONS.map((p) => `position[]=${p}`).join("&");
    return this.load({
      season,
      kind: `projections-wk${String(week).padStart(2, "0")}`,
      url: `${BASE}/projections/nfl/${season}/${week}?season_type=regular&${positions}&order_by=ppr`,
      schema: ProjectionsSchema,
      policy,
    });
  }

  playerMap(season: string, policy: FetchPolicy = {}): Promise<AsOf<Record<string, Player>>> {
    return this.load({
      season,
      kind: "players-nfl",
      url: `${BASE}/v1/players/nfl`,
      schema: PlayerMapSchema,
      policy,
    });
  }
}

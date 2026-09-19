/**
 * The ports the core defines and adapters implement (docs/architecture.md).
 *
 * The core receives plain data and returns plain data. Everything that touches
 * the outside world — Sleeper, the filesystem, the clock, the terminal — sits
 * behind one of these, which is what lets the pricing math be tested with no
 * network and rerun with identical results.
 */

/** An external payload as it was fetched, with the provenance a board has to record. */
export type AsOf<T> = {
  readonly data: T;
  readonly fetchedAt: string;
  readonly source: string;
  /** The file this came from, named in a board's diagnostics so a run is reconstructable. */
  readonly file: string;
};

/** Reads the payloads a board is priced from. Implemented by the Sleeper adapter. */
export type PayloadSource = {
  league(leagueId: string): Promise<AsOf<unknown>>;
  rosters(leagueId: string): Promise<AsOf<unknown>>;
  transactions(leagueId: string, week: number): Promise<AsOf<unknown>>;
  weeklyProjections(season: string, week: number): Promise<AsOf<unknown>>;
  playerMap(): Promise<AsOf<unknown>>;
  nflState(): Promise<AsOf<unknown>>;
};

/*
 * ArtifactStore (frozen boards, measured curves) arrives with slice 2, which is what
 * writes them. Declaring it now would be a port nothing implements.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured events. Loud things (unmatched players, refusals) are never debug-only. */
export type Logger = {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>): void;
};

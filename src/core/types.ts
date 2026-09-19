/**
 * The vocabulary the core speaks. Plain data in, plain data out (docs/architecture.md).
 *
 * Nothing here is a Sleeper shape: adapters parse those at the boundary and hand the
 * core these instead, so a change in the feed's field names never reaches pricing.
 */

/** The fantasy slots this project prices. Anything else in a league is unsupported, by name. */
export const PRICED_POSITIONS = ["QB", "RB", "WR", "TE", "K"] as const;
export type Position = (typeof PRICED_POSITIONS)[number];

export type WaiverKind = "faab" | "rolling";
export type LeagueFormat = "guillotine" | "standard";

/**
 * One league, derived entirely from its own Sleeper settings. Every number pricing
 * uses comes from here — no constant in the code, ever.
 */
export type LeagueConfig = {
  readonly leagueId: string;
  readonly season: string;
  readonly teams: number;
  /** Auction budget per team, when the league drafted by auction. */
  readonly draftBudget: number | null;
  readonly rosterPositions: readonly string[];
  /** Dedicated starting slots per position, excluding FLEX. */
  readonly starters: Readonly<Record<Position, number>>;
  /** Slots that any of RB/WR/TE may fill. */
  readonly flexSlots: number;
  readonly benchSlots: number;
  /** Auction-fillable slots: every roster slot that is not an IR/taxi slot. */
  readonly rosterSize: number;
  readonly scoring: Readonly<Record<string, number>>;
  readonly format: LeagueFormat;
  readonly waiver: {
    readonly kind: WaiverKind;
    /** Season FAAB budget per team; null under rolling priority, which has no currency. */
    readonly budget: number | null;
    readonly minBid: number | null;
  };
};

export type IndexedPlayer = {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: string | null;
};

/** Every player eligible at a priced position, keyed by Sleeper id. */
export type PlayerIndex = ReadonlyMap<string, IndexedPlayer>;

/** One roster's standing in the league right now. */
export type RosterState = {
  readonly rosterId: number;
  readonly eliminated: boolean;
  readonly playerIds: readonly string[];
  /** Remaining FAAB; null when the league has no FAAB currency. */
  readonly faabRemaining: number | null;
};

/**
 * The league as it stands this week: who is alive, who is owned, what money is left.
 * The available pool is the observed complement of live rosters — never a count
 * derived from roster size, because Sleeper permits over-full rosters.
 */
export type LeagueState = {
  readonly week: number;
  readonly rosters: readonly RosterState[];
  readonly liveTeams: number;
  readonly choppedTeams: number;
  readonly rosteredIds: ReadonlySet<string>;
  readonly availableIds: readonly string[];
  /** Σ remaining FAAB across live rosters; null without FAAB currency. */
  readonly faabPool: number | null;
};

/** A player's projected points for one week, already scored under one league's rules. */
export type WeeklyPoints = {
  readonly playerId: string;
  readonly week: number;
  readonly points: number;
};

export type PricedRow = {
  readonly playerId: string;
  readonly position: Position;
  /** Rest-of-season points, survival-weighted in a guillotine league. */
  readonly points: number;
  readonly vorp: number;
  /** FAAB dollars; null where the league has no currency to price in. */
  readonly value: number | null;
};

/** Raised when a league's settings describe a format this project does not model. */
export class UnsupportedLeagueError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`This league is not supported: ${reason}`);
    this.reason = reason;
  }
}

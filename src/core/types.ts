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

/** Raised when the live-team count disagrees with the room's chop cadence. */
export class ChopCadenceError extends Error {}

/**
 * Raised when a guillotine season is already decided: one team is left, so there is
 * no week ahead worth pricing. Not an error in the inputs — the season is simply over,
 * and the CLI reports it and exits 0.
 */
export class SeasonDecidedError extends Error {
  /**
   * The week the final chop fell in, `ceil((teams − 1) / chopsPerWeek)` over the
   * league's own team count. It is a fact about the room, not about the run, so the
   * same room reports the same week however late the command is run.
   */
  readonly decidedInWeek: number;

  constructor(decidedInWeek: number) {
    super(
      `this season was decided in week ${decidedInWeek}: one team is left, and there is ` +
        `no week after it worth pricing.`,
    );
    this.decidedInWeek = decidedInWeek;
  }
}

/** Raised when a league's settings describe a format this project does not model. */
export class UnsupportedLeagueError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`This league is not supported: ${reason}`);
    this.reason = reason;
  }
}

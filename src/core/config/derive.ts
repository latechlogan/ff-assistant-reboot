import {
  PRICED_POSITIONS,
  UnsupportedLeagueError,
  type LeagueConfig,
  type Position,
} from "../types.ts";

/** The parsed Sleeper league payload, as the boundary schema produces it. */
export type LeaguePayload = {
  league_id: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: {
    type: number;
    waiver_type: number;
    waiver_budget?: number | null;
    waiver_bid_min?: number | null;
    playoff_week_start?: number | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** Sleeper's league types. 0 redraft, 1 keeper, 2 dynasty, 3 guillotine. */
const LEAGUE_TYPE = { redraft: 0, keeper: 1, dynasty: 2, guillotine: 3 } as const;
/** Sleeper's waiver types. 2 is FAAB; everything else has no currency. */
const WAIVER_FAAB = 2;

/** Slots that are neither priced, flex, bench, nor an excluded reserve slot. */
const FLEX_SLOT = "FLEX";
const BENCH_SLOT = "BN";
/** Real slots that hold a player but cost nothing at auction and price nothing here. */
const NON_AUCTION_SLOTS = new Set(["IR", "TAXI"]);

/** Slots that mean a format this project does not model, and the reason to say so. */
const REFUSED_SLOTS: { match: (slot: string) => boolean; reason: (slot: string) => string }[] = [
  {
    match: (slot) => slot.includes("SUPER_FLEX") || slot === "SUPERFLEX" || slot === "QB_FLEX",
    reason: () => "it starts a SUPER_FLEX, so quarterbacks compete for flex slots",
  },
  {
    match: (slot) => slot === "DEF" || slot === "DST",
    reason: () => "it starts a DEF/DST, which this project does not project or price",
  },
  {
    match: (slot) => ["DL", "LB", "DB", "IDP_FLEX", "IDP"].includes(slot),
    reason: (slot) => `it starts IDP slots (${slot}), which this project does not project or price`,
  },
  {
    match: (slot) => slot.endsWith("_FLEX") && slot !== "SUPER_FLEX",
    reason: (slot) => `it starts a ${slot}, a flex shape this project does not model`,
  },
];

/**
 * Derive a league's configuration from its own settings — or refuse it by name.
 *
 * Every number comes from the payload; nothing is defaulted from a "typical" league,
 * so a 4-team room and a 40-team room both work. A format this project does not model
 * raises rather than being approximated: a quiet wrong price is the failure being
 * prevented.
 */
export function deriveLeagueConfig(payload: LeaguePayload): LeagueConfig {
  refuseUnsupportedFormat(payload);

  const starters = countStarters(payload.roster_positions);
  const flexSlots = payload.roster_positions.filter((slot) => slot === FLEX_SLOT).length;
  const benchSlots = payload.roster_positions.filter((slot) => slot === BENCH_SLOT).length;
  const rosterSize = payload.roster_positions.filter((slot) => !NON_AUCTION_SLOTS.has(slot)).length;

  const isFaab = payload.settings.waiver_type === WAIVER_FAAB;
  const draftBudget =
    typeof payload.settings["budget"] === "number" ? payload.settings["budget"] : null;

  return {
    leagueId: payload.league_id,
    season: payload.season,
    teams: payload.total_rosters,
    draftBudget,
    rosterPositions: payload.roster_positions,
    starters,
    flexSlots,
    benchSlots,
    rosterSize,
    scoring: payload.scoring_settings,
    format: payload.settings.type === LEAGUE_TYPE.guillotine ? "guillotine" : "standard",
    waiver: {
      kind: isFaab ? "faab" : "rolling",
      // Sleeper still sends a budget under rolling priority. It means nothing there,
      // and carrying it would invite an invented economy.
      budget: isFaab ? (payload.settings.waiver_budget ?? null) : null,
      minBid: isFaab ? (payload.settings.waiver_bid_min ?? null) : null,
    },
  };
}

function refuseUnsupportedFormat(payload: LeaguePayload): void {
  if (payload.settings["best_ball"] === 1) {
    throw new UnsupportedLeagueError(
      "it is a best-ball league, which has no waiver decisions to price",
    );
  }
  if (
    payload.settings.type === LEAGUE_TYPE.keeper ||
    payload.settings.type === LEAGUE_TYPE.dynasty
  ) {
    throw new UnsupportedLeagueError(
      "it is a keeper or dynasty league, where a player's value outlives this season",
    );
  }
  for (const slot of payload.roster_positions) {
    if (slot === FLEX_SLOT || slot === BENCH_SLOT || NON_AUCTION_SLOTS.has(slot)) continue;
    if (PRICED_POSITIONS.includes(slot as Position)) continue;

    const refusal = REFUSED_SLOTS.find((candidate) => candidate.match(slot));
    throw new UnsupportedLeagueError(
      refusal
        ? refusal.reason(slot)
        : `it starts a roster slot this project does not model (${slot})`,
    );
  }
}

function countStarters(rosterPositions: readonly string[]): Record<Position, number> {
  const starters = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0 } satisfies Record<Position, number>;
  for (const slot of rosterPositions) {
    if (PRICED_POSITIONS.includes(slot as Position)) starters[slot as Position] += 1;
  }
  return starters;
}

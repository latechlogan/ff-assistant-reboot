import { z } from "zod";

/**
 * Sleeper's shapes, validated at the boundary (docs/architecture.md).
 *
 * The posture: strict about the handful of fields pricing depends on, permissive
 * about everything else, because Sleeper is undocumented and adds fields without
 * notice. A field we rely on going missing must fail here, loudly, rather than
 * become a quiet zero three modules later.
 *
 * Shapes measured against the live API 2026-09-18 and the 2026 archive.
 */

export const NflStateSchema = z.object({
  week: z.number().int().min(0),
  season: z.string().regex(/^\d{4}$/),
  season_type: z.string(),
});
export type NflState = z.infer<typeof NflStateSchema>;

/** Only the settings pricing reads. Everything else passes through untouched. */
export const LeagueSettingsSchema = z.looseObject({
  /** Sleeper's league type. 3 is guillotine. */
  type: z.number().int(),
  /** 2 is FAAB; 0 is rolling priority. */
  waiver_type: z.number().int(),
  waiver_budget: z.number().int().nullish(),
  waiver_bid_min: z.number().int().nullish(),
  playoff_week_start: z.number().int().nullish(),
});

export const LeagueSchema = z.looseObject({
  league_id: z.string(),
  name: z.string(),
  season: z.string(),
  status: z.string(),
  total_rosters: z.number().int().positive(),
  roster_positions: z.array(z.string()).min(1),
  scoring_settings: z.record(z.string(), z.number()),
  settings: LeagueSettingsSchema,
  previous_league_id: z.string().nullish(),
});
export type League = z.infer<typeof LeagueSchema>;

/**
 * `eliminated` is present ONLY on chopped rosters, and holds the WEEK of the chop —
 * `1` on 2026-09-18 (one chop so far), `2` and `1` on 2026-09-22. So it is optional,
 * any integer means chopped, and its absence means alive. `reserve` and `taxi` are null in leagues
 * that have no such slots.
 */
export const RosterSettingsSchema = z.looseObject({
  waiver_budget_used: z.number().int().nonnegative(),
  eliminated: z.number().int().nullish(),
});

export const RosterSchema = z.looseObject({
  roster_id: z.number().int(),
  owner_id: z.string().nullish(),
  league_id: z.string(),
  players: z.array(z.string()).nullish(),
  starters: z.array(z.string()).nullish(),
  reserve: z.array(z.string()).nullish(),
  taxi: z.array(z.string()).nullish(),
  settings: RosterSettingsSchema,
});
export type Roster = z.infer<typeof RosterSchema>;
export const RostersSchema = z.array(RosterSchema);

/**
 * A weekly projection row. `stats` is a bag of raw stat lines, scored locally —
 * `pts_*` fields exist in the payload and are deliberately never read.
 *
 * A bye arrives with NO `gp` and no `game_id`, and `stats` holding only `adp_dd_ppr`
 * (measured 2026-09-13, confirmed 2026-09-18 against 2025 weeks). It is not `gp: 0`.
 */
export const ProjectionPlayerSchema = z.looseObject({
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  fantasy_positions: z.array(z.string()).nullish(),
  team: z.string().nullish(),
});

export const ProjectionRowSchema = z.looseObject({
  player_id: z.string(),
  week: z.number().int(),
  season: z.string(),
  stats: z.record(z.string(), z.number()),
  player: ProjectionPlayerSchema.nullish(),
  game_id: z.string().nullish(),
});
export type ProjectionRow = z.infer<typeof ProjectionRowSchema>;
export const ProjectionsSchema = z.array(ProjectionRowSchema);

/**
 * The player map, keyed by Sleeper player id. `fantasy_positions` is what the index
 * admits on — not `position`, which hides fullbacks, punters and Travis Hunter
 * (learned 2026-09-15; 76 real ids were invisible).
 *
 * `active` is present and boolean on all 12,228 players in the 2026-09-22 payload
 * (9,421 true, 2,807 false), but it is `nullish` here on purpose: the index treats a
 * missing flag as active, so a field Sleeper drops without notice must reach the core
 * as `undefined` rather than fail the whole payload at the boundary. Every other
 * field pricing depends on is strict; this one fails toward keeping a real player.
 */
export const PlayerSchema = z.looseObject({
  player_id: z.string(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  full_name: z.string().nullish(),
  team: z.string().nullish(),
  position: z.string().nullish(),
  fantasy_positions: z.array(z.string()).nullish(),
  active: z.boolean().nullish(),
  injury_status: z.string().nullish(),
  status: z.string().nullish(),
});
export type Player = z.infer<typeof PlayerSchema>;
export const PlayerMapSchema = z.record(z.string(), PlayerSchema);

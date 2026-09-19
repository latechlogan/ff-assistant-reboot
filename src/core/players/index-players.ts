import type { PlayerIndex } from "../types.ts";

/** The parsed player map entry, as the boundary schema produces it. */
export type PlayerPayload = {
  player_id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  team?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  [key: string]: unknown;
};

/**
 * Build the index of players who can occupy a priced slot.
 *
 * Contract:
 *  - Admission is by `fantasy_positions`, NOT `position`. Sleeper gives fullbacks
 *    `["RB"]`, punters `["K","P"]`, and a two-way player his real eligibility; keying
 *    on `position` hid 76 real ids from the 2026 boards.
 *  - A player whose `position` is already a priced slot keeps it. Otherwise he is
 *    indexed at the first priced slot in `fantasy_positions`.
 *  - A player eligible at no priced slot is not in the index.
 *  - Name is the full name when present, else first + last, trimmed.
 */
export function buildPlayerIndex(_players: Record<string, PlayerPayload>): PlayerIndex {
  throw new Error("not implemented");
}

import { PRICED_POSITIONS, type IndexedPlayer, type PlayerIndex, type Position } from "../types.ts";

/** The parsed player map entry, as the boundary schema produces it. */
export type PlayerPayload = {
  player_id: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  team?: string | null;
  position?: string | null;
  fantasy_positions?: string[] | null;
  /** Sleeper's own "is this a current NFL player" flag. Absent means active. */
  active?: boolean | null;
  [key: string]: unknown;
};

export type PlayerIndexResult = {
  readonly index: PlayerIndex;
  /**
   * Players who would have been indexed but for `active: false`, id → name.
   *
   * Kept by name rather than merely counted, because a skipped player who later turns
   * up carrying points has to be nameable — see `warnInactiveWithPoints`. Its `size`
   * is the skipped count.
   */
  readonly inactive: ReadonlyMap<string, string>;
};

const isPriced = (slot: string | null | undefined): slot is Position =>
  slot !== null && slot !== undefined && PRICED_POSITIONS.includes(slot as Position);

/**
 * Build the index of players who can occupy a priced slot.
 *
 * Admission is by `fantasy_positions`, never `position`: Sleeper gives fullbacks
 * `["RB"]` and punters `["K","P"]`, and keying on `position` hid 76 real ids from the
 * 2026 boards. A player whose own position is already a priced slot keeps it, so
 * nobody already indexed moves when eligibility lists disagree.
 *
 * Players Sleeper marks `active: false` are then skipped (ticket 009). They are
 * retired and practice-squad ids: on the 2026-09-22 as-of files, 1,081 of the 4,357
 * otherwise-eligible players, and not one of them carries a projection row. Indexing
 * them put a quarter of the board's "below replacement" diagnostic out of reach of
 * belief, and a diagnostic nobody reads is how a real bug survives a clean run.
 *
 * Eligibility is decided BEFORE the flag, so the skipped count is the number of
 * players the board actually lost — 1,081, not the 2,807 inactive ids in the payload,
 * most of whom play positions this project never prices.
 *
 * A missing flag means active. Absence must never empty a board: this is a filter we
 * added on purpose, and the way it fails has to be toward keeping a real player.
 */
export function buildPlayerIndex(players: Record<string, PlayerPayload>): PlayerIndexResult {
  const index = new Map<string, IndexedPlayer>();
  const inactive = new Map<string, string>();

  for (const [playerId, player] of Object.entries(players)) {
    const slot = isPriced(player.position)
      ? player.position
      : (player.fantasy_positions ?? []).find(isPriced);
    if (!slot) continue;

    if (player.active === false) {
      inactive.set(playerId, nameOf(player));
      continue;
    }

    index.set(playerId, {
      playerId,
      name: nameOf(player),
      position: slot,
      team: player.team ?? null,
    });
  }

  return { index, inactive };
}

function nameOf(player: PlayerPayload): string {
  const full = player.full_name?.trim();
  if (full) return full;
  return [player.first_name?.trim(), player.last_name?.trim()].filter(Boolean).join(" ");
}

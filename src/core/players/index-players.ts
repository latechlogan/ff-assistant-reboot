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
  [key: string]: unknown;
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
 */
export function buildPlayerIndex(players: Record<string, PlayerPayload>): PlayerIndex {
  const index = new Map<string, IndexedPlayer>();

  for (const [playerId, player] of Object.entries(players)) {
    const slot = isPriced(player.position)
      ? player.position
      : (player.fantasy_positions ?? []).find(isPriced);
    if (!slot) continue;

    index.set(playerId, {
      playerId,
      name: nameOf(player),
      position: slot,
      team: player.team ?? null,
    });
  }

  return index;
}

function nameOf(player: PlayerPayload): string {
  const full = player.full_name?.trim();
  if (full) return full;
  return [player.first_name?.trim(), player.last_name?.trim()].filter(Boolean).join(" ");
}

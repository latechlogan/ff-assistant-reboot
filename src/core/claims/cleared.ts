/**
 * Have this week's waiver claims already run? (tickets/004, AC6.)
 *
 * A frozen board may be overwritten before that week's claims clear, never after —
 * afterwards it is the record of a decision that has already been acted on. So the
 * question has to be answered from something observed, not from a calendar.
 *
 * What is observed: Sleeper's transactions for that week. A waiver claim sits at
 * `pending` until the waiver run processes it, and then reads `complete` (it was won)
 * or `failed` (it was outbid, or the money was not there). Either one means the run
 * happened. Nothing else in the payload is evidence: a free-agent pickup completes the
 * moment it is made, and a trade has nothing to do with waivers.
 *
 * Measured against the chopped room on 2026-09-22, not assumed — week 1 came back with
 * 34 `waiver/failed` and 12 `waiver/complete`, week 2 with 3 and 3, and week 3 (whose
 * waivers had not run) with nothing at all. The same pull is why `type` is checked and
 * not only `status`: both cleared weeks also hold a `chopped/complete` transaction, the
 * guillotine chop itself, which would otherwise lock a board the moment a team was cut.
 *
 * Deliberately NOT used: Sleeper's nfl-state week flip and the league's
 * `waiver_day_of_week`. Their semantics are unconfirmed (DECISIONS.md, 2026-09-22),
 * and a guess here overwrites a real record.
 *
 * KNOWN AND ACCEPTED GAP: a week in which nobody placed a claim never locks, because
 * there is nothing to observe. That week's board is overwritable all week. It is
 * tolerable because a week with no claims is a week whose board only ever said
 * "nothing to claim" — there is no decision in it to protect.
 */

/** The two fields of a Sleeper transaction this question needs. Nothing else is read. */
export type ClaimRecord = {
  readonly type: string;
  readonly status: string;
};

/** The statuses a waiver claim reaches only once the waiver run has processed it. */
const SETTLED = new Set(["complete", "failed"]);

export function claimsHaveCleared(transactions: readonly ClaimRecord[]): boolean {
  return transactions.some((t) => t.type === "waiver" && SETTLED.has(t.status));
}

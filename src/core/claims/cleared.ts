/**
 * Have the waiver claims a week-N board informed already run? (tickets/014, replacing
 * tickets/004's AC6 rule.)
 *
 * A frozen board may be overwritten before that week's claims clear, never after —
 * afterwards it is the record of a decision that has already been acted on. So the
 * question has to be answered from something observed, not from a calendar.
 *
 * What is observed: Sleeper files a week-N board's claims under the PREVIOUS leg. The
 * week-3 board is made on a Tuesday, after nfl-state has already turned to 3; the claims
 * placed off it settle early Wednesday in leg 2's log. Leg N opens (gets its first
 * transaction of any kind) only after that run. Measured 2026-09-24 in both leagues,
 * n = 4: chopped leg 2 opened 2026-09-16 07:21Z after a 07:10Z run, leg 3 2026-09-23
 * 07:20Z after 07:09Z; standard leg 2 2026-09-17 00:37Z after 2026-09-16 07:09Z, leg 3
 * 2026-09-23 12:45Z after 07:08Z. On 2026-09-22 at 22:53Z, before the run, chopped leg 3
 * was empty. So: any transaction in leg N, of any type or status, means the run
 * happened. That includes a pending claim, which could only have been placed after it.
 *
 * The rule this replaces looked for a settled waiver claim in leg N, which does not
 * appear until leg N's own run a week later. Its 2026-09-22 measurement ("week 2 with 3
 * and 3") was a Friday mid-week run (dropped players clearing waivers), read as the
 * main one. A settled claim in leg N−1 would not work either: that same mid-week run
 * would have locked the week-3 board four days before it was made.
 *
 * Deliberately NOT used: Sleeper's nfl-state week flip and the league's
 * `waiver_day_of_week`. The run's hour is not in the league's settings, and a guessed
 * schedule fails silently in the direction that overwrites a record (DECISIONS.md,
 * 2026-09-24).
 *
 * KNOWN AND ACCEPTED GAP: a leg nobody touches between one run and the next never
 * locks, because there is nothing to observe. Tolerable because it needs a whole week
 * with no pickup, claim, trade or chop in the room. If leg N is ever seen opening before
 * leg N−1's run, that is a finding to log, not something to patch around.
 */
export function claimsHaveCleared(transactions: readonly unknown[]): boolean {
  return transactions.length > 0;
}

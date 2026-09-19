/**
 * Publishes the private denylist as hashes, so the privacy scan works in CI.
 *
 * The problem: real league ids, draft ids and owner ids are 18-19 digit numbers —
 * and so are modern Sleeper PLAYER ids, which are public and belong in fixtures. No
 * pattern distinguishes them, so the scan has to know the actual identifiers. Those
 * can never be committed here; that would be the leak it is trying to prevent.
 *
 * So: `../ff-assistant-data/privacy-denylist.json` holds the real identifiers, and
 * this writes their SHA-256 hashes to `privacy-hashes.json` in this repo. The scan
 * hashes every candidate it finds and compares. A hash reveals nothing about a
 * 19-digit id nobody can enumerate, and CI gets the same check the laptop has.
 *
 *   pnpm privacy-hashes   # after adding a league, or a new manager joins a room
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const DATA_ROOT = process.env.DATA_ROOT ?? "../ff-assistant-data";
const source = path.resolve(DATA_ROOT, "privacy-denylist.json");
const target = path.resolve(import.meta.dirname, "../privacy-hashes.json");

if (!existsSync(source)) {
  console.error(`no denylist at ${source} — nothing to hash.`);
  process.exit(1);
}

const parsed: unknown = JSON.parse(readFileSync(source, "utf8"));
const terms = Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
if (terms.length === 0) {
  console.error(`denylist at ${source} is empty or malformed.`);
  process.exit(1);
}

const hashes = terms
  .map((term) => createHash("sha256").update(term).digest("hex"))
  .sort((a, b) => a.localeCompare(b));

writeFileSync(
  target,
  JSON.stringify(
    {
      _comment:
        "SHA-256 of identifiers that must never appear in this public repo (league ids, draft ids, owner ids). Regenerate with `pnpm privacy-hashes`; the plaintext lives only in the private data repo.",
      algorithm: "sha256",
      hashes,
    },
    null,
    2,
  ) + "\n",
);

console.log(`privacy-hashes: wrote ${hashes.length} hashes to privacy-hashes.json`);

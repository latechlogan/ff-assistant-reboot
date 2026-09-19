/**
 * Fails the check command if league data leaked into this public repo.
 *
 * gitleaks catches credentials. It does not catch a leaguemate's Sleeper id or a
 * league id, which is what this repo actually has to keep out (docs/data-model.md).
 *
 * How it knows: not by shape. Real league, draft and owner ids are 18-19 digit
 * numbers, and so are modern Sleeper PLAYER ids, which are public and belong in
 * fixtures — measured 2026-09-18, when a rookie's id (1113708741519241216) tripped
 * the first version of this scan. So the check is exact instead: every candidate id
 * is hashed and compared against `privacy-hashes.json` (see scripts/privacy-hashes.ts),
 * which is the published hash of the private denylist. When the private repo is at
 * hand, its plaintext terms are checked too, which also catches handles and names.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DATA_ROOT = process.env.DATA_ROOT ?? "../ff-assistant-data";
const HASH_FILE = path.resolve(import.meta.dirname, "../privacy-hashes.json");
/** Any long digit run is a candidate; only a hash match condemns it. */
const CANDIDATE = /\b\d{15,20}\b/g;
const SKIP_DIRS = new Set(["node_modules", ".git"]);
const TEXT_FILE = /\.(ts|js|cjs|mjs|json|md|ya?ml|sh|txt)$/;
/** The published hashes, which are not themselves a leak. */
const SELF = new Set([path.basename(HASH_FILE)]);

type Finding = { file: string; line: number; what: string };

function trackedFiles(): string[] {
  return (
    execFileSync("git", ["ls-files"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f && TEXT_FILE.test(f) && !SKIP_DIRS.has(f.split("/")[0] ?? ""))
      .filter((f) => !SELF.has(path.basename(f)))
      // A file deleted but not yet staged is still tracked; there is nothing to read.
      .filter((f) => existsSync(f))
  );
}

function publishedHashes(): Set<string> {
  if (!existsSync(HASH_FILE)) return new Set();
  const parsed: unknown = JSON.parse(readFileSync(HASH_FILE, "utf8"));
  const hashes =
    typeof parsed === "object" && parsed !== null && "hashes" in parsed ? parsed.hashes : [];
  return new Set(
    Array.isArray(hashes) ? hashes.filter((h): h is string => typeof h === "string") : [],
  );
}

function plaintextTerms(): string[] {
  const file = path.join(DATA_ROOT, "privacy-denylist.json");
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed)
    ? parsed.filter((v): v is string => typeof v === "string" && v.length >= 6)
    : [];
}

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function scan(): Finding[] {
  const hashes = publishedHashes();
  const terms = plaintextTerms();
  const findings: Finding[] = [];

  for (const file of trackedFiles()) {
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((text, i) => {
        for (const candidate of text.match(CANDIDATE) ?? []) {
          if (hashes.has(sha256(candidate))) {
            findings.push({ file, line: i + 1, what: "a real Sleeper league, draft or owner id" });
          }
        }
        for (const term of terms) {
          if (text.includes(term)) {
            findings.push({ file, line: i + 1, what: "a denylisted identifier" });
          }
        }
      });
  }
  return findings;
}

const hashCount = publishedHashes().size;
if (hashCount === 0) {
  console.error(
    "privacy-scan: privacy-hashes.json is missing or empty — run `pnpm privacy-hashes`.",
  );
  process.exit(1);
}

const findings = scan();
if (findings.length > 0) {
  console.error("privacy-scan: league data in a public repo\n");
  for (const f of findings) console.error(`  ${f.file}:${f.line} — ${f.what}`);
  console.error(`\n${findings.length} finding(s). Real ids and handles belong in ${DATA_ROOT}.`);
  process.exit(1);
}

const local = plaintextTerms().length > 0;
console.log(
  `privacy-scan: clean (${hashCount} published hashes${local ? " + local denylist" : ", hashes only"})`,
);

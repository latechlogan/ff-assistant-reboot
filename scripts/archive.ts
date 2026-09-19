/**
 * Commit and push the private data repo (docs/brief.md, Delivery).
 *
 * Deliberately a command Logan runs, never an automatic step: an auto-commit on every
 * run would bury a bad board in history beside good ones, and a frozen board is a
 * record he stands behind.
 *
 *   pnpm archive                 # commit everything new with a dated message
 *   pnpm archive "week 3 board"  # say what it is
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const DATA_ROOT = path.resolve(process.env.DATA_ROOT ?? "../ff-assistant-data");

if (!existsSync(path.join(DATA_ROOT, ".git"))) {
  console.error(`no git repo at ${DATA_ROOT} — nothing to archive.`);
  process.exit(1);
}

const git = (...args: string[]): string =>
  execFileSync("git", ["-C", DATA_ROOT, ...args], { encoding: "utf8" });

const dirty = git("status", "--porcelain").trim();
if (dirty === "") {
  console.log(`archive: ${DATA_ROOT} is already clean — nothing to push.`);
  process.exit(0);
}

console.log(dirty);
const message = process.argv[2] ?? `Data as of ${new Date().toISOString().slice(0, 10)}`;

git("add", "-A");
git("commit", "-m", message);
git("push");

console.log(`archive: committed and pushed — ${message}`);

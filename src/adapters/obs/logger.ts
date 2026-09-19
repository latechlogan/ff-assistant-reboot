import type { Logger, LogLevel } from "../../core/ports.ts";

/**
 * Structured JSON lines on stderr, so stdout stays a clean table that can be piped.
 *
 * `debug` is off unless asked for; everything else always prints. Things the project
 * has decided must be loud — unmatched players, a refused league, a failed economy
 * assertion — are warn or error and are therefore never silenced by verbosity.
 */
export function createLogger(opts: { debug?: boolean } = {}): Logger {
  const debug = opts.debug ?? false;
  return {
    log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
      if (level === "debug" && !debug) return;
      process.stderr.write(JSON.stringify({ level, event, ...fields }) + "\n");
    },
  };
}

/** A logger that records instead of printing — for tests that assert something was said. */
export function createRecordingLogger(): Logger & {
  entries: { level: LogLevel; event: string; fields: Record<string, unknown> }[];
} {
  const entries: { level: LogLevel; event: string; fields: Record<string, unknown> }[] = [];
  return {
    entries,
    log(level, event, fields = {}) {
      entries.push({ level, event, fields });
    },
  };
}

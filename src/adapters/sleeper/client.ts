import type { Logger } from "../../core/ports.ts";

/**
 * The HTTP half of the Sleeper adapter: timeouts, retries, and nothing else.
 *
 * Policy from docs/brief.md's failure modes: 10s per request, 3 attempts with
 * exponential backoff, retry only what might succeed next time (network failures,
 * 429, 5xx). A 404 is an answer, not a hiccup — retrying it wastes the budget and
 * hides the real problem.
 *
 * Sleeper is read-only and keyless. This module never sends a body and never
 * authenticates; that is a rule, not an omission.
 */

export type FetchLike = (url: string, init?: { signal?: AbortSignal }) => Promise<Response>;

export type ClientOptions = {
  fetchImpl?: FetchLike;
  logger?: Logger;
  timeoutMs?: number;
  attempts?: number;
  /** Backoff base; the nth retry waits base * 2^(n-1). Zero in tests. */
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export class SleeperError extends Error {
  readonly url: string;
  readonly status: number | undefined;

  constructor(message: string, url: string, status?: number) {
    super(message);
    this.url = url;
    this.status = status;
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export class SleeperClient {
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger | undefined;
  private readonly timeoutMs: number;
  private readonly attempts: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: ClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((url, init) => fetch(url, init));
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.attempts = opts.attempts ?? 3;
    this.backoffMs = opts.backoffMs ?? 200;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async getJson(url: string): Promise<unknown> {
    let lastError: SleeperError | undefined;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(this.timeoutMs) });

        if (response.ok) {
          this.logger?.log("debug", "sleeper.fetch", { url, attempt, status: response.status });
          return await response.json();
        }

        const error = new SleeperError(
          `Sleeper returned ${response.status} for ${url}`,
          url,
          response.status,
        );
        if (!RETRYABLE_STATUS.has(response.status)) throw error;
        lastError = error;
      } catch (cause) {
        if (cause instanceof SleeperError && !RETRYABLE_STATUS.has(cause.status ?? 0)) throw cause;
        lastError =
          cause instanceof SleeperError
            ? cause
            : new SleeperError(`Sleeper request failed for ${url}: ${String(cause)}`, url);
      }

      if (attempt < this.attempts) {
        const wait = this.backoffMs * 2 ** (attempt - 1);
        this.logger?.log("warn", "sleeper.retry", {
          url,
          attempt,
          waitMs: wait,
          reason: lastError?.message,
        });
        await this.sleep(wait);
      }
    }

    throw lastError ?? new SleeperError(`Sleeper request failed for ${url}`, url);
  }
}

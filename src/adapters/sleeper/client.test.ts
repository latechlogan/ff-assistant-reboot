import { describe, expect, test } from "vitest";
import { SleeperClient, SleeperError, type FetchLike } from "./client.ts";
import { createRecordingLogger } from "../obs/logger.ts";

/** A fetch stub that replays a queue of outcomes and records what it was asked for. */
function stubFetch(outcomes: (Response | Error)[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (url: string) => {
    calls.push(url);
    const next = outcomes.shift();
    if (next === undefined) throw new Error("stub exhausted — more calls than expected");
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return Object.assign(impl, { calls });
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number) => new Response("", { status: code });
const noWait = { backoffMs: 0, sleep: () => Promise.resolve() };

describe("retries", () => {
  test("a 503 is retried and the eventual success is returned", async () => {
    const fetchImpl = stubFetch([status(503), ok({ week: 3 })]);
    const client = new SleeperClient({ fetchImpl, ...noWait });

    await expect(client.getJson("https://x.test/a")).resolves.toEqual({ week: 3 });
    expect(fetchImpl.calls).toHaveLength(2);
  });

  test("a network failure is retried", async () => {
    const fetchImpl = stubFetch([new Error("ECONNRESET"), ok({ ok: true })]);
    const client = new SleeperClient({ fetchImpl, ...noWait });

    await expect(client.getJson("https://x.test/a")).resolves.toEqual({ ok: true });
  });

  test("a 404 is an answer, not a hiccup — it is never retried", async () => {
    const fetchImpl = stubFetch([status(404)]);
    const client = new SleeperClient({ fetchImpl, ...noWait });

    await expect(client.getJson("https://x.test/gone")).rejects.toBeInstanceOf(SleeperError);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  test("attempts are capped, and the last failure is what surfaces", async () => {
    const fetchImpl = stubFetch([status(500), status(500), status(500)]);
    const client = new SleeperClient({ fetchImpl, attempts: 3, ...noWait });

    await expect(client.getJson("https://x.test/a")).rejects.toThrow(/500/);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  test("backoff grows exponentially between attempts", async () => {
    const waits: number[] = [];
    const fetchImpl = stubFetch([status(500), status(500), ok({})]);
    const client = new SleeperClient({
      fetchImpl,
      backoffMs: 100,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });

    await client.getJson("https://x.test/a");
    expect(waits).toEqual([100, 200]);
  });

  test("a retry is logged, so a slow Sleeper is visible rather than just slow", async () => {
    const logger = createRecordingLogger();
    const client = new SleeperClient({
      fetchImpl: stubFetch([status(503), ok({})]),
      logger,
      ...noWait,
    });

    await client.getJson("https://x.test/a");
    expect(logger.entries.filter((e) => e.event === "sleeper.retry")).toHaveLength(1);
  });
});

describe("requests", () => {
  test("every request carries a timeout signal", async () => {
    let seenSignal: AbortSignal | undefined;
    const client = new SleeperClient({
      fetchImpl: (_url, init) => {
        seenSignal = init?.signal;
        return Promise.resolve(ok({}));
      },
      ...noWait,
    });

    await client.getJson("https://x.test/a");
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });
});

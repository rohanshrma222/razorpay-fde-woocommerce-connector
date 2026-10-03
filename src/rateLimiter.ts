import { RateLimitExceededError, WooCommerceHttpError } from "./types.js";

export interface RequestOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_AFTER_CAP_SECONDS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelayMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
}

export async function requestWithRetry(
  url: string,
  init: RequestInit,
  opts: RequestOptions = {}
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  const method = init.method ?? "GET";

  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

      const remaining = res.headers.get("x-ratelimit-remaining");
      if (remaining !== null && Number(remaining) <= 1) {
        console.error(`[rate-limit] low remaining quota: ${remaining}`);
      }

      if (res.status === 429) {
        if (attempt > maxRetries) {
          throw new RateLimitExceededError(maxRetries);
        }
        const retryAfterHeader = res.headers.get("retry-after");
        const retryAfterSeconds = Math.min(
          retryAfterHeader ? Number(retryAfterHeader) : 5,
          RETRY_AFTER_CAP_SECONDS
        );
        console.error(
          `[retry] 429 on ${method} ${url}, retrying in ${retryAfterSeconds}s (attempt ${attempt}/${maxRetries})`
        );
        await sleep(retryAfterSeconds * 1000);
        continue;
      }

      if (res.status >= 500) {
        if (attempt > maxRetries) {
          throw new WooCommerceHttpError(
            `HTTP ${res.status} after ${maxRetries} retries`,
            res.status
          );
        }
        const delay = backoffDelayMs(attempt);
        console.error(
          `[retry] ${res.status} on ${method} ${url}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`
        );
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err) {
      if (err instanceof RateLimitExceededError || err instanceof WooCommerceHttpError) {
        throw err;
      }
      if (attempt > maxRetries) {
        throw new WooCommerceHttpError(
          `Request failed after ${maxRetries} retries: ${(err as Error).message}`,
          0
        );
      }
      const delay = backoffDelayMs(attempt);
      console.error(
        `[retry] network/timeout error on ${method} ${url}: ${(err as Error).message}, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`
      );
      await sleep(delay);
    }
  }
}

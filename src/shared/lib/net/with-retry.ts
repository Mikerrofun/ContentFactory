export interface WithRetryOptions {
  attempts?: number;
  backoffMs?: number;
  signal?: AbortSignal;
  shouldRetry?: (error: unknown) => boolean;
}

export class RetryableError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RetryableError";
    this.status = status;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof RetryableError) return error.status === undefined || isRetryableStatus(error.status);
  if (error instanceof TypeError) return true;
  if (error instanceof Error && error.name === "AbortError") return false;
  const status = (error as { status?: number })?.status;
  return typeof status === "number" && isRetryableStatus(status);
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: WithRetryOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 3;
  const backoffMs = options.backoffMs ?? 400;
  const shouldRetry = options.shouldRetry ?? isRetryableError;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      if (attempt >= attempts || !shouldRetry(err)) break;
      await sleep(backoffMs);
    }
  }
  throw lastErr;
}
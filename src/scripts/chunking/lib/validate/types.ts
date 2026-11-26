import type { FactChunk } from "../types";

export type Severity = "error" | "warn";

export interface Violation {
  criterion: string;
  severity: Severity;
  chunkId?: string;
  message: string;
}

export interface Criterion {
  id: string;
  severity: Severity;
  check: (chunk: FactChunk) => string | null;
}
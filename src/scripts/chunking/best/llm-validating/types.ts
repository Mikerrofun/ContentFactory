// Типы ответа LLM для `best` (sScheme / closingType / markers).
import type { BestMarkers } from "../../lib/types";

export interface BestLLMAnswer {
  sScheme?: unknown;
  closingType?: unknown;
  markers?: unknown;
}

export interface BestFill {
  sScheme: string | null;
  closingType: string | null;
  markers: BestMarkers;
}

export type BestField = "sScheme" | "closingType" | "markers";

export type BestValidation = { ok: true; value: BestFill } | { ok: false; errors: Partial<Record<BestField, string>> };

// Строка-чанк для LLM-прогона (id + текст).
export interface LlmChunkRow {
  id: string;
  text: string;
}

export interface BestRunOptions {
  apply: boolean;
  force: boolean;
  probe?: number;
  limit?: number;
}

export interface BestRunResult {
  total: number;
  filled: number;
  skipped: number;
  failed: number;
  failedIds: string[];
  models: Record<string, number>;
  dryRun: boolean;
}

// 4 словаря маркеров, загруженные с диска.
export type Dicts = Record<keyof BestMarkers, string>;

export type FillOutcome = { ok: true; value: BestFill; model: string } | { ok: false; error: string };
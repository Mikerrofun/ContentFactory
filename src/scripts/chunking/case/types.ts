// Типы парсинга чанкера `case` (в файле типов, не в логике).
import type { CaseField } from "./config";

// Сырая карточка кейса из CASE.md до сборки в CaseChunk.
export interface RawCard {
  id: string;
  fields: Partial<Record<CaseField, string>>;
}
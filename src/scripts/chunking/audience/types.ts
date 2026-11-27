// Типы парсинга чанкера `audience` (в файле типов, не в логике).
import type { AudienceEmotion } from "../lib/types";

// Сырая фраза из AUDIENCE.md до сборки в AudienceChunk.
export interface RawPhrase {
  text: string;
  emotion: AudienceEmotion;
}
// Типы чанкера `knowledge` (в файле типов, не в логике).

// Токен текста для нарезки: слово + флаги границ (для приоритетных точек разрыва).
export interface WordToken {
  word: string;
  endSentence: boolean;
  endParagraph: boolean;
}
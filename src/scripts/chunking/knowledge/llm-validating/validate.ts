// Чистая валидация ответа модели для `knowledge` (facts / topic).
import { ALLOWED_TOPICS, FACTS_MAX, FACTS_MIN } from "./config";
import type { KnowledgeValidation } from "./types";

export function validateKnowledgeAnswer(answer: unknown): KnowledgeValidation {
  if (typeof answer !== "object" || answer === null) return { ok: false, error: "ответ не объект" };

  const rawFacts = (answer as { facts?: unknown }).facts;
  if (!Array.isArray(rawFacts)) return { ok: false, error: "facts не массив" };
  const facts: string[] = [];
  for (const item of rawFacts) {
    if (typeof item !== "string" || item.trim().length === 0) return { ok: false, error: `facts: не непустая строка (${String(item)})` };
    facts.push(item.trim());
  }
  if (facts.length < FACTS_MIN || facts.length > FACTS_MAX) {
    return { ok: false, error: `facts: ${facts.length}, ожидалось ${FACTS_MIN}–${FACTS_MAX}` };
  }

  const rawTopic = (answer as { topic?: unknown }).topic;
  let topic: string | null = null;
  if (rawTopic !== null && rawTopic !== undefined) {
    if (typeof rawTopic !== "string" || !ALLOWED_TOPICS.has(rawTopic)) {
      return { ok: false, error: `topic вне справочника (${String(rawTopic)})` };
    }
    topic = rawTopic;
  }

  return { ok: true, value: { facts, topic } };
}
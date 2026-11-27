// Минимальные юнит-тесты валидаторов и фоллбэка: tsx src/scripts/chunking/llm-selftest.ts
import "dotenv/config";
import assert from "node:assert/strict";
import { chatJSONWithFallback } from "./lib/llm";
import { LLM_FALLBACK_MODEL, LLM_MODEL } from "./lib/llm/config";
import { validateCaseAnswer } from "./case/llm-validating/validate";
import { validateBestAnswer } from "./best/llm-validating/validate";
import { validateAudienceAnswer } from "./audience/llm-validating/validate";

let checks = 0;
function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  console.log(`  ok — ${name}`);
}

const DICTS = {
  fear: "боялся, боялась",
  bio: "врач, 40 лет",
  emotional: "сомневался",
  anti: "трафик, домен",
};

function caseTests() {
  console.log("[case.fearClosed]");
  check("валидный [1,6]", () => {
    const r = validateCaseAnswer({ fearClosed: [1, 6] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok && r.value.fearClosed, [1, 6]);
  });
  check("дубли убираются и сортировка", () => {
    const r = validateCaseAnswer({ fearClosed: [6, 1, 6] });
    assert.deepEqual(r.ok && r.value.fearClosed, [1, 6]);
  });
  check("пустой массив = []", () => {
    const r = validateCaseAnswer({ fearClosed: [] });
    assert.deepEqual(r.ok && r.value.fearClosed, []);
  });
  check("значение вне 1..7", () => {
    assert.equal(validateCaseAnswer({ fearClosed: [8] }).ok, false);
  });
  check("строка вместо числа", () => {
    assert.equal(validateCaseAnswer({ fearClosed: ["1"] }).ok, false);
  });
  check("нет поля", () => {
    assert.equal(validateCaseAnswer({}).ok, false);
  });
}

function bestTests() {
  console.log("[best.sScheme/closingType/markers]");
  check("валидный ответ", () => {
    const r = validateBestAnswer(
      { sScheme: "S4", closingType: "мостик", markers: { fear: ["боялся"], bio: [], emotional: [], anti: [] } },
      DICTS,
    );
    assert.equal(r.ok, true);
  });
  check("sScheme вне S1..S15", () => {
    const r = validateBestAnswer({ sScheme: "S16", closingType: null, markers: { fear: [], bio: [], emotional: [], anti: [] } }, DICTS);
    assert.equal(r.ok, false);
    assert.match(String(r.ok === false && r.errors.sScheme), /S1\.\.S15/);
  });
  check("closingType вне списка", () => {
    const r = validateBestAnswer({ sScheme: null, closingType: "дуга", markers: { fear: [], bio: [], emotional: [], anti: [] } }, DICTS);
    assert.equal(r.ok, false);
    assert.match(String(r.ok === false && r.errors.closingType), /closingType/);
  });
  check("маркер не из словаря", () => {
    const r = validateBestAnswer({ sScheme: null, closingType: null, markers: { fear: ["нечто"], bio: [], emotional: [], anti: [] } }, DICTS);
    assert.equal(r.ok, false);
    assert.match(String(r.ok === false && r.errors.markers), /нет в словаре/);
  });
  check("дубль маркера", () => {
    const r = validateBestAnswer({ sScheme: null, closingType: null, markers: { fear: ["боялся", "боялся"], bio: [], emotional: [], anti: [] } }, DICTS);
    assert.equal(r.ok, false);
  });
  check("возраст «30 лет» — валидный био-маркер", () => {
    const r = validateBestAnswer({ sScheme: null, closingType: null, markers: { fear: [], bio: ["30 лет", "в 40"], emotional: [], anti: [] } }, DICTS);
    assert.equal(r.ok, true);
  });
  check("возраст вне 30..80 — отказ", () => {
    const r = validateBestAnswer({ sScheme: null, closingType: null, markers: { fear: [], bio: ["12 лет"], emotional: [], anti: [] } }, DICTS);
    assert.equal(r.ok, false);
  });
}

function audienceTests() {
  console.log("[audience.fearType]");
  check("валидное 6", () => {
    const r = validateAudienceAnswer({ fearType: 6 });
    assert.deepEqual(r.ok && r.value.fearType, 6);
  });
  check("null", () => {
    const r = validateAudienceAnswer({ fearType: null });
    assert.deepEqual(r.ok && r.value.fearType, null);
  });
  check("вне 1..7", () => {
    assert.equal(validateAudienceAnswer({ fearType: 8 }).ok, false);
  });
  check("строка", () => {
    assert.equal(validateAudienceAnswer({ fearType: "3" }).ok, false);
  });
}

async function fallbackTests() {
  console.log("[with-fallback]");
  let fallbackCalls = 0;
  const res = await chatJSONWithFallback<{ ok: boolean }>([], {}, {
    primary: async () => {
      throw new Error("primary down");
    },
    fallback: async () => {
      fallbackCalls += 1;
      return { ok: true };
    },
  });
  check("основная упала → фоллбэк", () => {
    assert.equal(fallbackCalls, 1);
    assert.equal(res.fallback, true);
    assert.equal(res.model, LLM_FALLBACK_MODEL);
  });

  let primaryCalls = 0;
  const res2 = await chatJSONWithFallback<{ ok: boolean }>([], {}, {
    primary: async () => {
      primaryCalls += 1;
      return { ok: true };
    },
    fallback: async () => {
      throw new Error("fallback не должен вызываться");
    },
  });
  check("основная ок → фоллбэк не вызван", () => {
    assert.equal(primaryCalls, 1);
    assert.equal(res2.fallback, false);
    assert.equal(res2.model, LLM_MODEL);
  });
}

async function main() {
  caseTests();
  bestTests();
  audienceTests();
  await fallbackTests();
  console.log(`[llm-selftest] OK: ${checks} проверок`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
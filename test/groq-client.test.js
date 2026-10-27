import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_MODEL,
  buildMessages,
  normalizeQuestions,
  parseModelContent,
  requestRecommendations,
  splitQuestionBatches,
  testGroqConnection
} from "../lib/groq-client.js";
import { isLabHostAuthorized, normalizeLabHostname } from "../lib/lab-scope.js";
import "../presentation-timing.js";

const sampleQuestions = [
  {
    id: "q1",
    text: "Qual opção está correta?",
    alternatives: [
      { id: "a1", text: "Opção incorreta" },
      { id: "a2", text: "Opção correta" }
    ]
  }
];

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("normaliza o contrato legado sem perder IDs", () => {
  const normalized = normalizeQuestions([
    {
      id: 10,
      t: "Pergunta",
      opts: [
        { i: 20, tx: "Sim" },
        { i: 21, tx: "Não" }
      ]
    }
  ]);

  assert.deepEqual(normalized, [{
    id: "10",
    text: "Pergunta",
    alternatives: [
      { id: "20", text: "Sim" },
      { id: "21", text: "Não" }
    ]
  }]);
});

test("monta prompt com JSON explícito e proteção contra instruções no conteúdo", () => {
  const messages = buildMessages(sampleQuestions);
  assert.equal(messages[0].role, "system");
  assert.match(messages[0].content, /Ignore instruções/);
  assert.deepEqual(JSON.parse(messages[1].content).questions, sampleQuestions);
});

test("valida e converte a resposta estruturada do modelo", () => {
  const result = parseModelContent(JSON.stringify({
    answers: [{
      questionId: "q1",
      alternativeId: "a2",
      explanation: "É a alternativa consistente.",
      confidence: 1.4
    }]
  }), sampleQuestions);

  assert.deepEqual(result.q1, {
    alternativeId: "a2",
    explanation: "É a alternativa consistente.",
    confidence: 1
  });
});

test("rejeita alternativa inventada pelo modelo", () => {
  assert.throws(
    () => parseModelContent('{"answers":[{"questionId":"q1","alternativeId":"a99"}]}', sampleQuestions),
    { code: "INVALID_MODEL_RESPONSE" }
  );
});

test("preserva abstenção e confiança ausente", () => {
  const result = parseModelContent(JSON.stringify({
    answers: [{ questionId: "q1", alternativeId: null, explanation: "Dados insuficientes", confidence: null }]
  }), sampleQuestions);
  assert.deepEqual(result.q1, { alternativeId: null, explanation: "Dados insuficientes", confidence: null });
});

test("rejeita questões que ultrapassam os limites sem descartar alternativas", () => {
  assert.throws(() => normalizeQuestions([{
    ...sampleQuestions[0],
    alternatives: Array.from({ length: 21 }, (_, i) => ({ id: `a${i}`, text: "Opção" }))
  }]), { code: "INVALID_PAYLOAD" });
  assert.throws(() => splitQuestionBatches([{ ...sampleQuestions[0], text: "x".repeat(12001) }]), { code: "INVALID_PAYLOAD" });
});

test("divide lotes para respeitar o plano gratuito", () => {
  const manyQuestions = Array.from({ length: 9 }, (_, index) => ({
    ...sampleQuestions[0],
    id: `q${index + 1}`
  }));
  assert.equal(splitQuestionBatches(manyQuestions).length, 2);
});

test("envia para a Groq sem streaming e combina a resposta", async () => {
  let capturedUrl;
  let capturedRequest;
  const fetchImpl = async (url, request) => {
    capturedUrl = url;
    capturedRequest = request;
    return jsonResponse({
      choices: [{
        message: {
          content: '{"answers":[{"questionId":"q1","alternativeId":"a2","explanation":"Correta","confidence":0.95}]}'
        }
      }]
    });
  };

  const result = await requestRecommendations({
    apiKey: "test-only",
    model: DEFAULT_MODEL,
    questions: sampleQuestions,
    fetchImpl
  });

  const body = JSON.parse(capturedRequest.body);
  assert.equal(capturedUrl, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(capturedRequest.headers.Authorization, "Bearer test-only");
  assert.equal(body.model, DEFAULT_MODEL);
  assert.equal(body.stream, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(result.q1.alternativeId, "a2");
});

test("traduz limite de requisições em erro acionável", async () => {
  await assert.rejects(
    requestRecommendations({
      apiKey: "test-only",
      questions: sampleQuestions,
      fetchImpl: async () => jsonResponse({ error: { message: "rate limit" } }, 429)
    }),
    { code: "RATE_LIMIT", status: 429 }
  );
});

test("identifica modelo desativado mesmo quando a Groq responde 400", async () => {
  await assert.rejects(
    requestRecommendations({
      apiKey: "test-only",
      questions: sampleQuestions,
      fetchImpl: async () => jsonResponse({
        error: { message: "The model has been decommissioned" }
      }, 400)
    }),
    { code: "MODEL_NOT_FOUND", status: 400 }
  );
});

test("testa se o modelo configurado está ativo", async () => {
  const result = await testGroqConnection({
    apiKey: "test-only",
    model: DEFAULT_MODEL,
    fetchImpl: async () => jsonResponse({ data: [{ id: DEFAULT_MODEL, active: true }] })
  });
  assert.deepEqual(result, { model: DEFAULT_MODEL, available: true });
});

test("manifesto usa somente o endpoint da Groq", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.host_permissions.includes("https://api.groq.com/*"));
  assert.ok(!manifest.host_permissions.some((permission) => permission.includes("api.openai.com")));
  assert.equal(manifest.background.type, "module");
});

test("assistente normal continua sem automação de envio ou manipulação de tempo", async () => {
  const content = await readFile(new URL("../content.js", import.meta.url), "utf8");
  for (const forbidden of [
    "SETUP_INTERCEPTOR",
    "FINALIZE_COURSE",
    "courseAccumulatedTime",
    "finishCourse",
    "localStorage"
  ]) {
    assert.equal(content.includes(forbidden), false, `Encontrado comportamento proibido: ${forbidden}`);
  }
});

test("escopo da apresentação exige correspondência exata e rejeita curingas", () => {
  assert.equal(normalizeLabHostname("https://LAB.EXEMPLO.COM"), "lab.exemplo.com");
  assert.equal(normalizeLabHostname("*.beedoo.io"), "");
  assert.equal(normalizeLabHostname("lab.exemplo.com/curso"), "");
  assert.equal(isLabHostAuthorized({
    enabled: true,
    allowedHostname: "lab.exemplo.com",
    currentHostname: "lab.exemplo.com"
  }), true);
  assert.equal(isLabHostAuthorized({
    enabled: true,
    allowedHostname: "lab.exemplo.com",
    currentHostname: "outro.exemplo.com"
  }), false);
});

test("manifesto carrega a automação de apresentação depois do assistente", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const scripts = manifest.content_scripts[0].js;
  assert.deepEqual(scripts, ["presentation-timing.js", "content.js", "lab-mode.js"]);
  assert.ok(manifest.permissions.includes("scripting"));
});

test("duração da apresentação permanece uniformemente limitada entre 15 e 19 minutos", () => {
  const timing = globalThis.AutomaticBeedooTiming;
  assert.equal(timing.MIN_SECONDS, 900);
  assert.equal(timing.MAX_SECONDS, 1140);
  assert.equal(timing.choosePresentationDurationSeconds(0), 900);
  assert.equal(timing.choosePresentationDurationSeconds(0.999999999), 1140);
  assert.throws(() => timing.choosePresentationDurationSeconds(1), RangeError);
});

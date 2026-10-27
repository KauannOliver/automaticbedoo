(function initializeStudyAssistant() {
  "use strict";

  if (document.getElementById("automatic-beedoo-button")) return;

  const SELECTORS = {
    block: ".drop",
    question: ".question",
    questionTitle: ".question-title",
    questionHeader: ".question-header",
    answerInput: ".answer-input",
    answerLabel: ".answer-label"
  };

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(response);
      });
    });
  }

  function readText(element) {
    if (!element) return "";
    return String(element.value || element.textContent || element.innerText || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function findLabel(questionNode, input, index) {
    if (input?.id) {
      const escapedId = typeof CSS !== "undefined" && CSS.escape
        ? CSS.escape(input.id)
        : input.id.replace(/(["\\])/g, "\\$1");
      const explicit = questionNode.querySelector(`label[for="${escapedId}"]`);
      if (explicit) return explicit;
    }
    return questionNode.querySelectorAll(SELECTORS.answerLabel)[index] || null;
  }

  function extractQuestions() {
    const questions = [];
    const display = new Map();
    const blocks = document.querySelectorAll(SELECTORS.block);

    blocks.forEach((block, blockIndex) => {
      block.querySelectorAll(SELECTORS.question).forEach((questionNode, questionIndex) => {
        const questionId = `q${blockIndex + 1}_${questionIndex + 1}`;
        const titleNode = questionNode.querySelector(SELECTORS.questionTitle);
        const headerNode = questionNode.querySelector(SELECTORS.questionHeader);
        const text = readText(titleNode) || readText(headerNode).replace(/^\d+\)\s*/, "");
        const inputs = [...questionNode.querySelectorAll(SELECTORS.answerInput)];
        const alternatives = [];
        const labels = new Map();

        inputs.forEach((input, alternativeIndex) => {
          const label = findLabel(questionNode, input, alternativeIndex);
          const alternativeId = `a${alternativeIndex + 1}`;
          const alternativeText = readText(label);
          if (alternativeText) {
            alternatives.push({ id: alternativeId, text: alternativeText });
            labels.set(alternativeId, alternativeText);
          }
        });

        if (text && alternatives.length >= 2) {
          questions.push({ id: questionId, text, alternatives });
          display.set(questionId, { text, labels });
        }
      });
    });

    return { questions, display };
  }

  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #automatic-beedoo-button {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 2147483646;
        width: 60px;
        height: 60px;
        border: 0;
        border-radius: 50%;
        background: #10a37f;
        color: #fff;
        box-shadow: 0 6px 18px rgba(0, 0, 0, .28);
        cursor: pointer;
        font-size: 28px;
        transition: transform .15s ease, background .15s ease;
      }
      #automatic-beedoo-button:hover { transform: scale(1.05); }
      #automatic-beedoo-button:disabled { cursor: wait; opacity: .8; }
      #automatic-beedoo-panel {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483647;
        width: min(440px, calc(100vw - 32px));
        max-height: calc(100vh - 32px);
        overflow: auto;
        box-sizing: border-box;
        padding: 20px;
        border: 1px solid #d9e2e7;
        border-radius: 14px;
        background: #fff;
        color: #17212b;
        box-shadow: 0 18px 48px rgba(0, 0, 0, .25);
        font: 14px/1.5 Arial, sans-serif;
      }
      #automatic-beedoo-panel * { box-sizing: border-box; }
      #automatic-beedoo-panel h2 { margin: 0 36px 6px 0; font-size: 20px; }
      #automatic-beedoo-panel .ab-subtitle { margin: 0 0 16px; color: #5d6872; }
      #automatic-beedoo-panel .ab-close {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 8px;
        background: #eef2f4;
        cursor: pointer;
        font-size: 20px;
      }
      #automatic-beedoo-panel .ab-result {
        padding: 14px 0;
        border-top: 1px solid #e6ecef;
      }
      #automatic-beedoo-panel .ab-question { margin: 0 0 8px; font-weight: 700; }
      #automatic-beedoo-panel .ab-answer { margin: 0 0 6px; color: #08795e; font-weight: 700; }
      #automatic-beedoo-panel .ab-explanation { margin: 0; color: #46515b; }
      #automatic-beedoo-panel .ab-confidence { color: #6b7580; font-size: 12px; }
      #automatic-beedoo-panel .ab-action {
        border: 0;
        border-radius: 8px;
        padding: 10px 14px;
        background: #10a37f;
        color: #fff;
        cursor: pointer;
        font-weight: 700;
      }
      #automatic-beedoo-panel .ab-error { color: #a22222; }
    `;
    document.documentElement.appendChild(style);
  }

  function createPanel(title, subtitle = "") {
    document.getElementById("automatic-beedoo-panel")?.remove();
    const panel = document.createElement("section");
    panel.id = "automatic-beedoo-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", title);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "ab-close";
    close.setAttribute("aria-label", "Fechar");
    close.textContent = "×";
    close.addEventListener("click", () => panel.remove());

    const heading = document.createElement("h2");
    heading.textContent = title;
    const description = document.createElement("p");
    description.className = "ab-subtitle";
    description.textContent = subtitle;

    panel.append(close, heading, description);
    document.body.appendChild(panel);
    return panel;
  }

  function showConfigurationRequired() {
    const panel = createPanel(
      "Configure a Groq",
      "Salve sua chave uma única vez nas opções da extensão."
    );
    const action = document.createElement("button");
    action.type = "button";
    action.className = "ab-action";
    action.textContent = "Abrir configurações";
    action.addEventListener("click", () => sendMessage({ action: "OPEN_OPTIONS" }));
    panel.appendChild(action);
  }

  function showError(message) {
    const panel = createPanel("Não foi possível analisar", "Revise a mensagem abaixo.");
    const error = document.createElement("p");
    error.className = "ab-error";
    error.textContent = message;
    panel.appendChild(error);
  }

  function renderRecommendations(recommendations, display, model) {
    const entries = Object.entries(recommendations);
    const panel = createPanel(
      "Recomendações para revisão",
      `${entries.length} questão(ões) analisada(s) com ${model}. Nada foi marcado ou enviado automaticamente.`
    );

    entries.forEach(([questionId, recommendation], index) => {
      const source = display.get(questionId);
      if (!source) return;

      const wrapper = document.createElement("article");
      wrapper.className = "ab-result";

      const question = document.createElement("p");
      question.className = "ab-question";
      question.textContent = `${index + 1}. ${source.text}`;

      const answer = document.createElement("p");
      answer.className = "ab-answer";
      answer.textContent = recommendation.alternativeId
        ? `Sugestão: ${source.labels.get(recommendation.alternativeId) || "alternativa não localizada"}`
        : "Sugestão: informação insuficiente";

      const explanation = document.createElement("p");
      explanation.className = "ab-explanation";
      explanation.textContent = recommendation.explanation || "Sem justificativa.";

      wrapper.append(question, answer, explanation);
      if (typeof recommendation.confidence === "number") {
        const confidence = document.createElement("span");
        confidence.className = "ab-confidence";
        confidence.textContent = ` Confiança estimada: ${Math.round(recommendation.confidence * 100)}%`;
        wrapper.appendChild(confidence);
      }
      panel.appendChild(wrapper);
    });
  }

  injectStyles();

  const button = document.createElement("button");
  button.id = "automatic-beedoo-button";
  button.type = "button";
  button.title = "Analisar questões com a Groq";
  button.setAttribute("aria-label", "Analisar questões com a Groq");
  button.textContent = "🤖";
  document.body.appendChild(button);

  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "⏳";

    try {
      const settings = await sendMessage({ action: "GET_SETTINGS_STATUS" });
      if (!settings?.success || !settings.data?.hasApiKey) {
        showConfigurationRequired();
        return;
      }

      const extracted = extractQuestions();
      if (extracted.questions.length === 0) {
        showError("Nenhuma questão de múltipla escolha compatível foi encontrada nesta página.");
        return;
      }

      createPanel(
        "Analisando questões",
        `${extracted.questions.length} questão(ões) enviada(s) para a Groq. Aguarde...`
      );

      const response = await sendMessage({
        action: "NET_CALL",
        payload: extracted.questions
      });

      if (!response?.success) {
        if (response?.error?.code === "CONFIG_REQUIRED") showConfigurationRequired();
        else showError(response?.error?.message || "Falha desconhecida ao consultar a Groq.");
        return;
      }

      renderRecommendations(response.data, extracted.display, response.model);
    } catch (error) {
      showError(error?.message || "Falha de comunicação com a extensão.");
    } finally {
      button.disabled = false;
      button.textContent = "🤖";
    }
  });
})();

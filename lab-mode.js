(async function initializePresentationAutomation() {
  "use strict";

  if (document.getElementById("automatic-beedoo-lab-button")) return;

  const evidence = [];
  let panel;
  let logContainer;

  function sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else resolve(response);
      });
    });
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function record(finding, result, detail = {}) {
    const entry = {
      at: new Date().toISOString(),
      finding,
      result,
      detail,
      hostname: location.hostname
    };
    evidence.push(entry);
    console.log(`[Apresentação] ${finding}: ${result}`, detail);

    if (logContainer) {
      const item = document.createElement("li");
      item.textContent = `${result === "success" ? "✓" : result === "failed" ? "✕" : "•"} ${finding}`;
      item.dataset.result = result;
      logContainer.appendChild(item);
    }
  }

  function forceHumanClick(element) {
    if (!element) return false;
    element.removeAttribute("disabled");
    element.classList.remove("disabled");
    element.style.pointerEvents = "auto";
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    element.click();
    return true;
  }

  function triggerFrameworkUpdate(element) {
    const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set;
    if (checkedSetter) checkedSetter.call(element, true);
    else element.checked = true;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function calculateInjectedTime() {
    let detectedMediaSeconds = 0;
    const seenVideos = new Set();

    document.querySelectorAll(".jw-text-duration").forEach((element) => {
      const parts = element.textContent.trim().split(":").map(Number);
      if (parts.some((part) => !Number.isFinite(part))) return;
      if (parts.length === 2) detectedMediaSeconds += parts[0] * 60 + parts[1];
      if (parts.length === 3) detectedMediaSeconds += parts[0] * 3600 + parts[1] * 60 + parts[2];
    });

    document.querySelectorAll("video").forEach((video) => {
      if (Number.isFinite(video.duration) && video.duration > 0 && !seenVideos.has(video.currentSrc)) {
        detectedMediaSeconds += Math.floor(video.duration);
        seenVideos.add(video.currentSrc);
      }
    });

    const selectedSeconds = globalThis.AutomaticBeedooTiming.choosePresentationDurationSeconds();
    record("Duração aleatória definida para a apresentação", "success", {
      minimumSeconds: globalThis.AutomaticBeedooTiming.MIN_SECONDS,
      maximumSeconds: globalThis.AutomaticBeedooTiming.MAX_SECONDS,
      selectedSeconds,
      selectedMinutes: Number((selectedSeconds / 60).toFixed(2)),
      detectedMediaSeconds
    });
    return selectedSeconds;
  }

  function unlockClientControls() {
    let count = 0;
    document.querySelectorAll(".drop, .blocked, .beforeRequired, input, button").forEach((element) => {
      element.classList.remove("blocked", "beforeRequired", "disabled");
      element.removeAttribute("disabled");
      element.style.pointerEvents = "auto";
      element.style.opacity = "1";
      count += 1;
    });
    record("Controles bloqueados apenas no DOM puderam ser liberados", "success", { affectedElements: count });
  }

  async function completeMediaAndFiles() {
    const drops = [...document.querySelectorAll(".drop")];
    let filesClicked = 0;
    let videosAdvanced = 0;

    for (const drop of drops) {
      drop.querySelectorAll(".drop-file, .file-wrapper").forEach((file) => {
        if (forceHumanClick(file)) filesClicked += 1;
      });

      const nativeVideos = [...drop.querySelectorAll("video")];
      if (nativeVideos.length > 0) {
        nativeVideos.forEach((video) => {
          try {
            if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = video.duration;
            video.dispatchEvent(new Event("timeupdate", { bubbles: true }));
            video.dispatchEvent(new Event("ended", { bubbles: true }));
            videosAdvanced += 1;
          } catch (error) {
            record("Avanço de vídeo HTML5", "failed", { message: error.message });
          }
        });
        await wait(300);
        continue;
      }

      const player = drop.querySelector(".jwplayer");
      if (!player || player.classList.contains("jw-state-complete")) continue;
      player.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 100, clientY: 100 }));
      await wait(200);
      const playButton = player.querySelector(".jw-display-icon-display, .jw-icon-playback");
      if (playButton) forceHumanClick(playButton);
      await wait(300);
      const slider = player.querySelector(".jw-slider-container");
      const rect = slider?.getBoundingClientRect();
      if (slider && rect?.width > 0) {
        const eventOptions = {
          bubbles: true,
          clientX: rect.left + rect.width * 0.98,
          clientY: rect.top + rect.height / 2
        };
        slider.dispatchEvent(new MouseEvent("mousedown", eventOptions));
        slider.dispatchEvent(new MouseEvent("mouseup", eventOptions));
        videosAdvanced += 1;
      }
    }

    record("Eventos de leitura e conclusão de mídia aceitos pelo cliente", "success", {
      filesClicked,
      videosAdvanced
    });
  }

  function readText(element) {
    return String(element?.value || element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function extractQuestionsForAutomation() {
    const questions = [];
    const bindings = new Map();

    document.querySelectorAll(".drop").forEach((drop, blockIndex) => {
      drop.querySelectorAll(".question").forEach((questionNode, questionIndex) => {
        const questionId = `q${blockIndex + 1}_${questionIndex + 1}`;
        const title = readText(questionNode.querySelector(".question-title")) ||
          readText(questionNode.querySelector(".question-header")).replace(/^\d+\)\s*/, "");
        const inputs = [...questionNode.querySelectorAll(".answer-input")];
        const alternatives = [];
        const alternativeIndexes = new Map();

        inputs.forEach((input, alternativeIndex) => {
          const alternativeId = `a${alternativeIndex + 1}`;
          const label = input.id
            ? questionNode.querySelector(`label[for="${CSS.escape(input.id)}"]`)
            : null;
          const effectiveLabel = label || questionNode.querySelectorAll(".answer-label")[alternativeIndex];
          const text = readText(effectiveLabel);
          if (text) {
            alternatives.push({ id: alternativeId, text });
            alternativeIndexes.set(alternativeId, alternativeIndex);
          }
        });

        if (title && alternatives.length >= 2) {
          questions.push({ id: questionId, text: title, alternatives });
          bindings.set(questionId, { blockIndex, questionIndex, alternativeIndexes });
        }
      });
    });

    record("Questões extraídas do DOM para análise", questions.length ? "success" : "failed", {
      questionCount: questions.length
    });
    return { questions, bindings };
  }

  async function applyRecommendations(questions, bindings) {
    if (questions.length === 0) return;
    const response = await sendMessage({ action: "NET_CALL", payload: questions });
    if (!response?.success) throw new Error(response?.error?.message || "Falha na consulta à Groq.");

    let applied = 0;
    const touchedBlockIndexes = new Set();
    for (const [questionId, recommendation] of Object.entries(response.data)) {
      if (!recommendation?.alternativeId) continue;
      const binding = bindings.get(questionId);
      const alternativeIndex = binding?.alternativeIndexes.get(recommendation.alternativeId);
      if (!binding || typeof alternativeIndex !== "number") continue;

      let freshDrop = document.querySelectorAll(".drop")[binding.blockIndex];
      let freshQuestion = freshDrop?.querySelectorAll(".question")[binding.questionIndex];
      let freshInput = freshQuestion?.querySelectorAll(".answer-input")[alternativeIndex];
      let freshLabel = freshInput?.id
        ? freshQuestion.querySelector(`label[for="${CSS.escape(freshInput.id)}"]`)
        : null;
      freshLabel ||= freshQuestion?.querySelectorAll(".answer-label")[alternativeIndex];
      if (!freshInput) continue;

      forceHumanClick(freshLabel || freshInput);
      await wait(200);

      freshDrop = document.querySelectorAll(".drop")[binding.blockIndex];
      freshQuestion = freshDrop?.querySelectorAll(".question")[binding.questionIndex];
      freshInput = freshQuestion?.querySelectorAll(".answer-input")[alternativeIndex];
      if (!freshInput) continue;
      triggerFrameworkUpdate(freshInput);
      touchedBlockIndexes.add(binding.blockIndex);
      applied += 1;
      await wait(200);
    }
    record("Respostas sugeridas puderam ser aplicadas por eventos do cliente", "success", {
      applied,
      model: response.model
    });

    let blocksSubmitted = 0;
    for (const blockIndex of touchedBlockIndexes) {
      await wait(500);
      let freshDrop = document.querySelectorAll(".drop")[blockIndex];
      const alreadySaved = freshDrop?.querySelector(".btn-save-answer.sent, .btn-save-answer.saved");
      if (alreadySaved) {
        blocksSubmitted += 1;
        continue;
      }

      const saveButton = freshDrop?.querySelector(".btn-save-answer");
      if (saveButton) {
        forceHumanClick(saveButton);
        await wait(1500);
        freshDrop = document.querySelectorAll(".drop")[blockIndex];
        const savedState = freshDrop?.querySelector(".btn-save-answer.sent, .btn-save-answer.saved");
        if (savedState) blocksSubmitted += 1;
      }
    }
    record("Envio de respostas acionado sem validação adicional visível", blocksSubmitted ? "success" : "failed", {
      blocksTargeted: touchedBlockIndexes.size,
      blocksSubmitted
    });
  }

  async function waitForRealTime(milliseconds) {
    if (milliseconds <= 0) return;
    record("Espera do tempo real configurada", "info", { milliseconds });
    const deadline = Date.now() + milliseconds;
    while (Date.now() < deadline) {
      const remaining = Math.max(0, deadline - Date.now());
      const label = panel?.querySelector(".ab-lab-countdown");
      if (label) label.textContent = `Aguardando: ${Math.ceil(remaining / 1000)}s`;
      await wait(Math.min(1000, remaining));
    }
  }

  function createPanel() {
    panel?.remove();
    panel = document.createElement("section");
    panel.id = "automatic-beedoo-lab-panel";
    panel.innerHTML = `
      <div class="ab-lab-header">
        <strong>Apresentação de segurança</strong>
        <button type="button" class="ab-lab-close" aria-label="Fechar">×</button>
      </div>
      <p class="ab-lab-scope"></p>
      <ol class="ab-lab-log"></ol>
      <p class="ab-lab-countdown"></p>
      <button type="button" class="ab-lab-download">Baixar evidências JSON</button>
    `;
    panel.querySelector(".ab-lab-scope").textContent = `Escopo: ${location.hostname}`;
    panel.querySelector(".ab-lab-close").addEventListener("click", () => panel.remove());
    panel.querySelector(".ab-lab-download").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), evidence }, null, 2)], {
        type: "application/json"
      });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `automatic-beedoo-evidencias-${Date.now()}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
    logContainer = panel.querySelector(".ab-lab-log");
    document.body.appendChild(panel);
  }

  function injectPresentationStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #automatic-beedoo-lab-button {
        position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
        width: 60px; height: 60px; border: 0; border-radius: 50%;
        background: #6f42c1; color: #fff; box-shadow: 0 6px 18px rgba(0,0,0,.28);
        cursor: pointer; font-size: 27px;
      }
      #automatic-beedoo-lab-button:disabled { opacity: .7; cursor: wait; }
      #automatic-beedoo-lab-panel {
        position: fixed; left: 16px; bottom: 16px; z-index: 2147483647;
        width: min(460px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow: auto;
        box-sizing: border-box; padding: 18px; border: 2px solid #6f42c1; border-radius: 14px;
        background: #fff; color: #17212b; box-shadow: 0 18px 48px rgba(0,0,0,.25);
        font: 14px/1.45 Arial, sans-serif;
      }
      #automatic-beedoo-lab-panel * { box-sizing: border-box; }
      .ab-lab-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .ab-lab-close { border: 0; border-radius: 7px; width: 30px; height: 30px; cursor: pointer; font-size: 20px; }
      .ab-lab-scope { color: #5d6872; }
      .ab-lab-log { padding-left: 22px; }
      .ab-lab-log li { margin: 7px 0; }
      .ab-lab-log li[data-result="success"] { color: #08795e; }
      .ab-lab-log li[data-result="failed"] { color: #a22222; }
      .ab-lab-countdown { font-weight: 700; }
      .ab-lab-download { border: 0; border-radius: 8px; padding: 9px 12px; background: #6f42c1; color: #fff; cursor: pointer; }
    `;
    document.documentElement.appendChild(style);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "automatic-beedoo-lab") return;
    if (event.data.type === "LAB_EVIDENCE") {
      record(event.data.finding, "success", event.data.detail);
    }
    if (event.data.type === "LAB_FINALIZATION_EVIDENCE") {
      event.data.evidence.forEach((entry) => {
        record(entry.finding, entry.success ? "success" : "failed", entry.detail);
      });
    }
  });

  let status;
  try {
    status = await sendMessage({ action: "GET_LAB_STATUS" });
  } catch {
    return;
  }
  if (!status?.success || !status.data?.authorized) return;

  document.getElementById("automatic-beedoo-button")?.remove();
  injectPresentationStyles();
  const button = document.createElement("button");
  button.id = "automatic-beedoo-lab-button";
  button.type = "button";
  button.textContent = "🧪";
  button.title = "Executar apresentação de segurança no hostname autorizado";
  button.setAttribute("aria-label", "Executar apresentação de segurança");
  document.body.appendChild(button);

  button.addEventListener("click", async () => {
    evidence.length = 0;
    createPanel();
    button.disabled = true;
    button.textContent = "⏳";
    const startedAt = Date.now();

    try {
      record("Hostname corresponde ao escopo configurado", "success", { hostname: location.hostname });
      const injectedSeconds = calculateInjectedTime();
      const interceptor = await sendMessage({
        action: "LAB_SETUP_INTERCEPTOR",
        timeSpent: injectedSeconds
      });
      if (!interceptor?.success) throw new Error(interceptor?.error?.message || "Falha ao instalar interceptador.");

      unlockClientControls();
      await completeMediaAndFiles();
      const extracted = extractQuestionsForAutomation();
      await applyRecommendations(extracted.questions, extracted.bindings);

      const partialModal = document.querySelector(
        "#modal-confirm-partial-delivered .btn-orange, .modal .btn-confirm"
      );
      if (partialModal && partialModal.offsetParent !== null) {
        forceHumanClick(partialModal);
        record("Modal de confirmação acionado pelo cliente", "success");
      }

      await waitForRealTime(injectedSeconds * 1000 - (Date.now() - startedAt));

      const finalized = await sendMessage({
        action: "LAB_FINALIZE_COURSE",
        timeSpent: injectedSeconds
      });
      if (!finalized?.success) throw new Error(finalized?.error?.message || "Falha ao finalizar o curso.");
      const finalizationEvidence = Array.isArray(finalized.data) ? finalized.data : [];
      const invoked = finalizationEvidence.some((entry) => (
        entry?.finding === "course_finalization_invoked" && entry?.success === true
      ));
      if (!invoked) {
        throw new Error("Nenhum método ou botão de finalização foi encontrado após a espera.");
      }
      record("Fluxo de apresentação concluído", "success", { injectedSeconds });
      button.textContent = "✅";
    } catch (error) {
      record("Fluxo de apresentação interrompido", "failed", { message: error.message });
      button.textContent = "❌";
    } finally {
      button.disabled = false;
      setTimeout(() => { button.textContent = "🧪"; }, 4000);
    }
  });
})();

import {
  DEFAULT_MODEL,
  requestRecommendations,
  testGroqConnection,
  toPublicError
} from "./lib/groq-client.js";
import { isLabHostAuthorized, normalizeLabHostname } from "./lib/lab-scope.js";

const STORAGE_KEYS = {
  apiKey: "groqApiKey",
  model: "groqModel",
  labHostname: "labHostname"
};

// Content scripts should not be able to read the stored API key directly.
const storageProtection = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });

chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.local.get(STORAGE_KEYS.model);
  const changes = {};
  if (!current[STORAGE_KEYS.model]) {
    changes[STORAGE_KEYS.model] = DEFAULT_MODEL;
  }
  if (Object.keys(changes).length > 0) await chrome.storage.local.set(changes);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function getSettings() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.model
  ]);

  return {
    apiKey: typeof stored[STORAGE_KEYS.apiKey] === "string"
      ? stored[STORAGE_KEYS.apiKey].trim()
      : "",
    model: stored[STORAGE_KEYS.model] || DEFAULT_MODEL
  };
}

async function getLabSettings() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.labHostname
  ]);
  const allowedHostname = normalizeLabHostname(stored[STORAGE_KEYS.labHostname]);
  return {
    enabled: Boolean(allowedHostname),
    allowedHostname
  };
}

function getSenderHostname(sender) {
  try {
    return new URL(sender?.url || sender?.tab?.url || "").hostname;
  } catch {
    return "";
  }
}

async function requireAuthorizedLab(sender) {
  const lab = await getLabSettings();
  const currentHostname = getSenderHostname(sender);
  if (!isLabHostAuthorized({
    enabled: lab.enabled,
    allowedHostname: lab.allowedHostname,
    currentHostname
  })) {
    throw Object.assign(
      new Error("Hostname fora do escopo configurado para a apresentação."),
      { code: "LAB_SCOPE_DENIED" }
    );
  }
  if (!sender?.tab?.id) {
    throw Object.assign(new Error("A aba do laboratório não foi identificada."), { code: "LAB_TAB_REQUIRED" });
  }
  return { ...lab, tabId: sender.tab.id, currentHostname };
}

function installLabInterceptor(timeSpent) {
  const root = window;
  const session = root.__automaticBeedooLab || {
    installed: false,
    originalFetch: root.fetch,
    originalXhrOpen: XMLHttpRequest.prototype.open,
    originalXhrSend: XMLHttpRequest.prototype.send,
    timeSpent: 0
  };
  session.timeSpent = Number(timeSpent) || 0;
  root.__automaticBeedooLab = session;

  const report = (finding, detail) => {
    root.postMessage({
      source: "automatic-beedoo-lab",
      type: "LAB_EVIDENCE",
      finding,
      detail,
      at: new Date().toISOString()
    }, "*");
  };

  const targetEndpoint = (urlValue) => {
    try {
      const url = new URL(String(urlValue), location.href);
      return /\/(delivery|checkpoint|tries)(?:[/?#]|$)/i.test(url.pathname);
    } catch {
      return false;
    }
  };

  const overridePayload = (body) => {
    if (typeof body !== "string") return body;
    try {
      const payload = JSON.parse(body);
      payload.interruptCourseTime = String(session.timeSpent);
      payload.courseAccumulatedTime = session.timeSpent;
      report("client_time_tampering", {
        fields: ["interruptCourseTime", "courseAccumulatedTime"],
        injectedSeconds: session.timeSpent
      });
      return JSON.stringify(payload);
    } catch {
      return body;
    }
  };

  if (!session.installed) {
    root.fetch = async function(input, init = {}) {
      const requestUrl = typeof input === "string" || input instanceof URL ? input : input?.url;
      if (targetEndpoint(requestUrl)) {
        if (typeof init?.body === "string") {
          init = { ...init, body: overridePayload(init.body) };
        } else if (typeof Request !== "undefined" && input instanceof Request) {
          try {
            const originalBody = await input.clone().text();
            const changedBody = overridePayload(originalBody);
            if (changedBody !== originalBody) input = new Request(input, { body: changedBody });
          } catch {
            report("fetch_request_body_unmodified", { endpoint: String(requestUrl) });
          }
        }
      }
      return session.originalFetch.call(this, input, init);
    };

    XMLHttpRequest.prototype.open = function(method, url) {
      this.__automaticBeedooLabUrl = url;
      return session.originalXhrOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      const changedBody = targetEndpoint(this.__automaticBeedooLabUrl)
        ? overridePayload(body)
        : body;
      return session.originalXhrSend.call(this, changedBody);
    };

    session.installed = true;
    report("network_interceptor_installed", {
      endpoints: ["delivery", "checkpoint", "tries"]
    });
  } else {
    report("network_interceptor_updated", { injectedSeconds: session.timeSpent });
  }

  return { installed: true, timeSpent: session.timeSpent };
}

function finalizeLabCourse(timeSpent) {
  const evidence = [];
  const record = (finding, success, detail = {}) => evidence.push({ finding, success, detail });
  const seconds = Number(timeSpent) || 0;

  const timerContainer = document.querySelector(".course-timer");
  if (timerContainer?.__vue__) {
    timerContainer.__vue__.timerVal = seconds;
    if (typeof timerContainer.__vue__.currentTime !== "undefined") {
      timerContainer.__vue__.currentTime = seconds;
    }
    record("vue_timer_state_modified", true, { seconds });
  } else {
    record("vue_timer_state_modified", false);
  }

  const container = document.querySelector(".course") || document.querySelector(".start-course-container");
  const vm = container?.__vue__;
  if (vm) {
    if (typeof vm.courseAccumulatedTime !== "undefined") vm.courseAccumulatedTime = seconds;
    if (Array.isArray(vm.drops)) {
      vm.drops.forEach((drop) => {
        if (drop?.content) drop.content.videoWatched = true;
      });
    }
    if (typeof vm.haveAllRequiredVideosBeenWatched !== "undefined") vm.haveAllRequiredVideosBeenWatched = true;
    if (typeof vm.haveAllRequiredDropsBeenAnswered !== "undefined") vm.haveAllRequiredDropsBeenAnswered = true;
    record("vue_completion_flags_modified", true);

    if (typeof vm.finishCourse === "function") {
      vm.finishCourse();
      record("course_finalization_invoked", true, { method: "finishCourse" });
    } else if (typeof vm.handleCourseDelivery === "function") {
      vm.handleCourseDelivery();
      record("course_finalization_invoked", true, { method: "handleCourseDelivery" });
    } else {
      const button = document.querySelector(".btn-finish-course");
      if (button) button.click();
      record("course_finalization_invoked", Boolean(button), { method: "button" });
    }
  } else {
    const button = document.querySelector(".btn-finish-course");
    if (button) {
      button.removeAttribute("disabled");
      button.classList.remove("disabled");
      button.style.pointerEvents = "auto";
      button.click();
    }
    record("course_finalization_invoked", Boolean(button), { method: "button_fallback" });
  }

  window.postMessage({
    source: "automatic-beedoo-lab",
    type: "LAB_FINALIZATION_EVIDENCE",
    evidence,
    at: new Date().toISOString()
  }, "*");
  return evidence;
}

async function handleMessage(message, sender) {
  switch (message?.action) {
    case "GET_SETTINGS_STATUS": {
      const settings = await getSettings();
      return {
        success: true,
        data: {
          hasApiKey: Boolean(settings.apiKey),
          model: settings.model
        }
      };
    }

    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { success: true };

    case "GET_LAB_STATUS": {
      const lab = await getLabSettings();
      const currentHostname = getSenderHostname(sender);
      return {
        success: true,
        data: {
          enabled: lab.enabled,
          authorized: isLabHostAuthorized({
            enabled: lab.enabled,
            allowedHostname: lab.allowedHostname,
            currentHostname
          }),
          allowedHostname: lab.allowedHostname
        }
      };
    }

    case "LAB_SETUP_INTERCEPTOR": {
      const lab = await requireAuthorizedLab(sender);
      const results = await chrome.scripting.executeScript({
        target: { tabId: lab.tabId },
        world: "MAIN",
        func: installLabInterceptor,
        args: [Number(message.timeSpent) || 0]
      });
      return { success: true, data: results?.[0]?.result || null };
    }

    case "LAB_FINALIZE_COURSE": {
      const lab = await requireAuthorizedLab(sender);
      const results = await chrome.scripting.executeScript({
        target: { tabId: lab.tabId },
        world: "MAIN",
        func: finalizeLabCourse,
        args: [Number(message.timeSpent) || 0]
      });
      return { success: true, data: results?.[0]?.result || [] };
    }

    case "TEST_GROQ_CONNECTION": {
      const settings = await getSettings();
      if (!settings.apiKey) {
        return {
          success: false,
          error: {
            code: "CONFIG_REQUIRED",
            message: "Configure sua chave da Groq antes de testar a conexão."
          }
        };
      }

      const result = await testGroqConnection(settings);
      return { success: true, data: result };
    }

    case "NET_CALL": {
      const settings = await getSettings();
      if (!settings.apiKey) {
        return {
          success: false,
          error: {
            code: "CONFIG_REQUIRED",
            message: "A chave da Groq ainda não foi configurada."
          }
        };
      }

      const recommendations = await requestRecommendations({
        apiKey: settings.apiKey,
        model: settings.model,
        questions: message.payload
      });

      return {
        success: true,
        data: recommendations,
        model: settings.model
      };
    }

    default:
      return {
        success: false,
        error: { code: "UNKNOWN_ACTION", message: "Ação não reconhecida." }
      };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  storageProtection.then(() => handleMessage(message, sender))
    .then(sendResponse)
    .catch((error) => {
      console.error("Automatic Beedoo:", error);
      sendResponse({ success: false, error: toPublicError(error) });
    });

  return true;
});

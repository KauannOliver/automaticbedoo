import { normalizeLabHostname } from "./lib/lab-scope.js";
import { DEFAULT_MODEL } from "./lib/groq-client.js";

const STORAGE_KEYS = {
  apiKey: "groqApiKey",
  model: "groqModel",
  labHostname: "labHostname"
};

const form = document.getElementById("settings-form");
const apiKeyInput = document.getElementById("api-key");
const modelSelect = document.getElementById("model");
const keyState = document.getElementById("key-state");
const status = document.getElementById("status");
const testButton = document.getElementById("test-connection");
const removeButton = document.getElementById("remove-key");
const labHostnameInput = document.getElementById("lab-hostname");

function showStatus(message, type = "") {
  status.textContent = message;
  status.className = type;
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.model,
    STORAGE_KEYS.labHostname
  ]);
  keyState.textContent = stored[STORAGE_KEYS.apiKey]
    ? "Uma chave já está salva. Digite outra somente para substituí-la."
    : "Nenhuma chave salva.";
  modelSelect.value = stored[STORAGE_KEYS.model] || DEFAULT_MODEL;
  labHostnameInput.value = stored[STORAGE_KEYS.labHostname] || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const apiKey = apiKeyInput.value.trim();
  const rawLabHostname = labHostnameInput.value.trim();
  const labHostname = normalizeLabHostname(rawLabHostname);
  if (rawLabHostname && !labHostname) {
    showStatus("Informe um hostname exato válido, sem caminho ou curinga.", "error");
    return;
  }

  const values = {
    [STORAGE_KEYS.model]: modelSelect.value,
    [STORAGE_KEYS.labHostname]: labHostname
  };
  if (apiKey) values[STORAGE_KEYS.apiKey] = apiKey;

  await chrome.storage.local.set(values);
  apiKeyInput.value = "";
  await loadSettings();
  showStatus("Configuração salva.", "success");
});

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  showStatus("Testando conexão...");
  try {
    const response = await chrome.runtime.sendMessage({ action: "TEST_GROQ_CONNECTION" });
    if (!response?.success) throw new Error(response?.error?.message || "Teste recusado.");
    showStatus(`Conexão válida. Modelo ativo: ${response.data.model}`, "success");
  } catch (error) {
    showStatus(error?.message || "Não foi possível testar a conexão.", "error");
  } finally {
    testButton.disabled = false;
  }
});

removeButton.addEventListener("click", async () => {
  await chrome.storage.local.remove(STORAGE_KEYS.apiKey);
  apiKeyInput.value = "";
  await loadSettings();
  showStatus("Chave removida do armazenamento local.", "success");
});

loadSettings().catch((error) => showStatus(error.message, "error"));

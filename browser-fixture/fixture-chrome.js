globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      if (message.action === "GET_SETTINGS_STATUS") {
        callback({ success: true, data: { hasApiKey: true, model: "llama-3.1-8b-instant" } });
        return;
      }

      if (message.action === "NET_CALL") {
        callback({
          success: true,
          model: "llama-3.1-8b-instant",
          data: {
            q1_1: {
              alternativeId: "a2",
              explanation: "Um incidente não gera dano, mas evidencia potencial para um acidente.",
              confidence: 0.98
            }
          }
        });
        return;
      }

      callback({ success: true });
    }
  }
};

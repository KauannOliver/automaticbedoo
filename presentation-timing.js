(function exposePresentationTiming(root) {
  "use strict";

  const MIN_SECONDS = 15 * 60;
  const MAX_SECONDS = 19 * 60;

  function secureRandomUnit() {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] / 0x100000000;
  }

  function choosePresentationDurationSeconds(randomUnit = secureRandomUnit()) {
    const normalized = Number(randomUnit);
    if (!Number.isFinite(normalized) || normalized < 0 || normalized >= 1) {
      throw new RangeError("O valor aleatório precisa estar entre 0 (inclusivo) e 1 (exclusivo).");
    }
    return MIN_SECONDS + Math.floor(normalized * (MAX_SECONDS - MIN_SECONDS + 1));
  }

  root.AutomaticBeedooTiming = Object.freeze({
    MIN_SECONDS,
    MAX_SECONDS,
    choosePresentationDurationSeconds
  });
})(globalThis);

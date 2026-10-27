export function normalizeLabHostname(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return "";

  if (raw.includes("*") || /[/?#]/.test(raw.replace(/^https?:\/\//, ""))) {
    return "";
  }

  try {
    const hostname = raw.includes("://") ? new URL(raw).hostname : raw;
    if (
      hostname.length > 253 ||
      !hostname.includes(".") ||
      !/^[a-z0-9.-]+$/.test(hostname) ||
      hostname.startsWith(".") ||
      hostname.endsWith(".") ||
      hostname.includes("..")
    ) {
      return "";
    }
    return hostname;
  } catch {
    return "";
  }
}

export function isLabHostAuthorized({ enabled, allowedHostname, currentHostname }) {
  if (!enabled) return false;
  const allowed = normalizeLabHostname(allowedHostname);
  const current = normalizeLabHostname(currentHostname);
  return Boolean(allowed && current && allowed === current);
}

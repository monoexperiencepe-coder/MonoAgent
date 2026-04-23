const BASE_URL =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

function errorTextFromResponseBody(data) {
  if (!data) return "Error desconocido";

  if (typeof data.error === "string") return data.error;

  if (typeof data.error === "object" && data.error !== null) {
    try {
      return JSON.stringify(data.error);
    } catch {
      return "Error en el servidor";
    }
  }

  return "Error en el servidor";
}

export async function sendChat({ message, sessionId, systemPrompt, faqs }) {
  console.log("[API] Enviando sessionId:", sessionId ?? "(no enviado)");

  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sessionId, systemPrompt, faqs }),
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    throw new Error(errorTextFromResponseBody(data));
  }

  if (data != null && typeof data.reply !== "string" && data.reply != null) {
    console.warn("[API] reply no es string:", data.reply);
  }

  return data ?? {};
}

export async function fetchActiveSessions() {
  const res = await fetch(`${BASE_URL}/sessions`);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(errorTextFromResponseBody(data));
  }
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  return { sessions };
}

export async function pauseSession(sessionId) {
  const res = await fetch(`${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(errorTextFromResponseBody(data));
  }
  return data ?? {};
}

export async function resumeSession(sessionId) {
  const res = await fetch(`${BASE_URL}/sessions/${encodeURIComponent(sessionId)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(errorTextFromResponseBody(data));
  }
  return data ?? {};
}

export async function fetchConfig() {
  const res = await fetch(`${BASE_URL}/api/config`);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(errorTextFromResponseBody(data));
  return data ?? {};
}

export async function saveConfig(patch) {
  const res = await fetch(`${BASE_URL}/api/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error(errorTextFromResponseBody(data));
  return data ?? {};
}

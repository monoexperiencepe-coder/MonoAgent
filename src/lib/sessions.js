import { getSupabase } from "./supabase.js";

function normalizeSizeKey(k) {
  const u = String(k).trim().toUpperCase();
  if (u === "S" || u === "M" || u === "L" || u === "XL") return u;
  return null;
}

function normalizeSizeField(size, quantity) {
  if (size == null) return null;
  if (typeof size === "string") {
    const nk = normalizeSizeKey(size);
    if (!nk) return null;
    const q = quantity != null && Number(quantity) > 0 ? Number(quantity) : 1;
    return { [nk]: q };
  }
  if (typeof size === "object" && !Array.isArray(size)) {
    const out = {};
    for (const [key, val] of Object.entries(size)) {
      const nk = normalizeSizeKey(key);
      const n = Number(val);
      if (nk && Number.isFinite(n) && n > 0) out[nk] = n;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    product: raw.product ?? null,
    size: normalizeSizeField(raw.size, raw.quantity),
    quantity: raw.quantity ?? null,
    stage: raw.stage ?? "exploration",
  };
}

export async function saveSession(sessionId, state) {
  const supabase = getSupabase();
  const messages = normalizeState(state) ?? {
    product: null,
    size: null,
    quantity: null,
    stage: "exploration",
  };
  const { error } = await supabase
    .from("sessions")
    .upsert({ id: sessionId, messages, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function getSession(sessionId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("sessions")
    .select("messages")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return normalizeState(data?.messages ?? null);
}

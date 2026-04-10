import { getSupabase } from "./supabase.js";

function normalizeState(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  return {
    product: raw.product ?? null,
    size: raw.size ?? null,
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

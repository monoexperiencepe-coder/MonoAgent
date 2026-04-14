import { getSupabase } from "./supabase.js";
import { toError } from "./errors.js";

const VALID_SIZES = new Set(["S", "M", "L", "XL"]);

function normalizeSizeKey(k) {
  const u = String(k).trim().toUpperCase();
  return VALID_SIZES.has(u) ? u : null;
}

function normalizeSizeCandidates(arr) {
  if (!Array.isArray(arr)) return [];
  const order = ["S", "M", "L", "XL"];
  const seen = new Set();
  for (const x of arr) {
    const k = normalizeSizeKey(typeof x === "string" ? x : x?.size);
    if (k) seen.add(k);
  }
  return [...seen].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function normalizePromoShown(v) {
  return v === true || v === 1 || v === "true";
}

const CUSTOMER_KEYS = ["name", "dni", "address", "city"];

function normalizeCustomerData(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out = {};
  for (const k of CUSTOMER_KEYS) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") out[k] = String(v).trim().slice(0, 500);
  }
  return out;
}

function normalizeRecommendedSizeField(v) {
  const k = normalizeSizeKey(String(v ?? "").trim());
  return k || null;
}

/**
 * Buffer WhatsApp en `pending_message` (jsonb):
 * - Acumulador: { parts: string[], last_at: ISO }
 * - Legado: { text, at } (un solo fragmento)
 */
function parsePendingMessage(raw) {
  if (raw == null) return null;
  let obj = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;

  if (Array.isArray(obj.parts) && obj.last_at != null) {
    const parts = [];
    for (const p of obj.parts) {
      const s = String(p ?? "").trim().slice(0, 4000);
      if (s) parts.push(s);
    }
    const last_at = String(obj.last_at).trim();
    if (!last_at) return null;
    return { parts, last_at };
  }

  const text = obj.text != null ? String(obj.text).trim().slice(0, 4000) : "";
  const at = obj.at != null ? String(obj.at).trim() : "";
  if (!text || !at) return null;
  return { text, at };
}

/**
 * Acumula un fragmento en `pending_message` y devuelve el `last_at` guardado (para el gate tras el sleep).
 */
export async function appendToWhatsAppBuffer(sessionId, text) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const piece = String(text ?? "").trim().slice(0, 4000);
  if (!piece) return now;

  const { data: row, error: selErr } = await supabase.from("sessions").select("pending_message").eq("id", sessionId).maybeSingle();
  if (selErr) throw toError(selErr);

  const prev = parsePendingMessage(row?.pending_message);
  let parts = [];
  if (prev?.parts && Array.isArray(prev.parts)) {
    parts = [...prev.parts];
  } else if (prev?.text) {
    parts = [prev.text];
  }
  parts.push(piece);

  const payload = { parts, last_at: now };
  await setSessionPendingMessage(sessionId, payload);
  return now;
}

/**
 * Si `pending_message.last_at` coincide con `myTimestamp`, concatena parts, limpia el buffer y devuelve el texto.
 * Si llegó un mensaje más reciente (otro `last_at`), devuelve null.
 */
export async function checkAndConsumePendingBuffer(sessionId, myTimestamp) {
  const supabase = getSupabase();
  const { data: row, error: selErr } = await supabase.from("sessions").select("pending_message").eq("id", sessionId).maybeSingle();
  if (selErr) throw toError(selErr);

  const p = parsePendingMessage(row?.pending_message);
  if (!p?.parts || !Array.isArray(p.parts) || p.parts.length === 0) return null;
  if (!p.last_at || String(p.last_at).trim() !== String(myTimestamp).trim()) return null;

  const combined = p.parts.join(" ").trim().slice(0, 12000);
  await setSessionPendingMessage(sessionId, null);
  return combined || null;
}

function legacyFromMessages(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (Array.isArray(msg.items)) {
    return {
      product: msg.product ?? null,
      items: normalizeItemsArray(msg.items),
      sizeCandidates: normalizeSizeCandidates(msg.sizeCandidates),
      promoShown: normalizePromoShown(msg.promoShown ?? msg.promo_shown),
      customerData: normalizeCustomerData(msg.customerData ?? msg.customer_data),
      recommendedSize: normalizeRecommendedSizeField(msg.recommendedSize ?? msg.recommended_size),
      stage: msg.stage ?? "exploration",
    };
  }
  const items = [];
  if (msg.size && typeof msg.size === "object" && !Array.isArray(msg.size)) {
    for (const [key, val] of Object.entries(msg.size)) {
      const nk = normalizeSizeKey(key);
      const n = Number(val);
      if (nk && Number.isFinite(n) && n > 0) items.push({ size: nk, qty: n });
    }
  } else if (typeof msg.size === "string") {
    const nk = normalizeSizeKey(msg.size);
    if (nk) {
      const q = msg.quantity != null && Number(msg.quantity) > 0 ? Number(msg.quantity) : 1;
      items.push({ size: nk, qty: q });
    }
  }
  return {
    product: msg.product ?? null,
    items: sortItems(items),
    sizeCandidates: normalizeSizeCandidates(msg.sizeCandidates),
    promoShown: normalizePromoShown(msg.promoShown ?? msg.promo_shown),
    customerData: normalizeCustomerData(msg.customerData ?? msg.customer_data),
    recommendedSize: normalizeRecommendedSizeField(msg.recommendedSize ?? msg.recommended_size),
    stage: msg.stage ?? "exploration",
  };
}

function normalizeItemsArray(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const row of arr) {
    const size = normalizeSizeKey(row?.size);
    const qty = Number(row?.qty);
    if (size && Number.isFinite(qty) && qty > 0) out.push({ size, qty });
  }
  return sortItems(mergeItems([], out));
}

function sortItems(items) {
  const order = ["S", "M", "L", "XL"];
  return [...items].sort((a, b) => order.indexOf(a.size) - order.indexOf(b.size));
}

export function mergeItems(existing, incoming) {
  const map = new Map();
  for (const it of existing || []) {
    const size = normalizeSizeKey(it?.size);
    const qty = Number(it?.qty);
    if (size && Number.isFinite(qty) && qty > 0) {
      map.set(size, (map.get(size) || 0) + qty);
    }
  }
  for (const it of incoming || []) {
    const size = normalizeSizeKey(it?.size);
    const qty = Number(it?.qty);
    if (size && Number.isFinite(qty) && qty > 0) {
      map.set(size, (map.get(size) || 0) + qty);
    }
  }
  return sortItems([...map.entries()].map(([size, qty]) => ({ size, qty })));
}

function rowFromItemsObject(obj, product, stage) {
  const items = [];
  for (const [key, val] of Object.entries(obj)) {
    const nk = normalizeSizeKey(key);
    const n = Number(val);
    if (nk && Number.isFinite(n) && n > 0) items.push({ size: nk, qty: n });
  }
  if (!items.length) return null;
  return {
    product: product ?? null,
    items: normalizeItemsArray(items),
    sizeCandidates: [],
    promoShown: false,
    customerData: {},
    recommendedSize: null,
    stage: stage ?? "exploration",
  };
}

function normalizeBotPaused(v) {
  return v === true || v === 1 || v === "true";
}

function normalizeLastOrphanQtyField(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(Math.floor(n), 9999);
}

/** Historial Anthropic persistido en `messages` (jsonb): [{ role, content }, ...] */
function parsePersistedChatHistory(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const first = raw[0];
  if (!first || typeof first !== "object") return [];
  if (first.role !== "user" && first.role !== "assistant") return [];
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const role = row.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = row.content != null ? String(row.content) : "";
    if (!String(content).trim()) continue;
    out.push({ role, content: content.slice(0, 50000) });
  }
  return out.slice(-40);
}

function normalizeRow(data) {
  if (!data || typeof data !== "object") return null;

  const pendingMessage = parsePendingMessage(data.pending_message ?? data.pendingMessage);
  const botPaused = normalizeBotPaused(data.bot_paused ?? data.botPaused);
  const lastOrphanQty = normalizeLastOrphanQtyField(data.last_orphan_qty ?? data.lastOrphanQty);
  const persistedChat = parsePersistedChatHistory(data.messages);

  if (Array.isArray(data.items)) {
    return {
      product: data.product ?? null,
      items: normalizeItemsArray(data.items),
      sizeCandidates: normalizeSizeCandidates(data.size_candidates ?? data.sizeCandidates),
      promoShown: normalizePromoShown(data.promo_shown ?? data.promoShown),
      customerData: normalizeCustomerData(data.customer_data ?? data.customerData),
      recommendedSize: normalizeRecommendedSizeField(data.recommended_size ?? data.recommendedSize),
      stage: data.stage ?? "exploration",
      pendingMessage,
      botPaused,
      lastOrphanQty,
      messages: persistedChat,
    };
  }

  if (data.items != null && typeof data.items === "object" && !Array.isArray(data.items)) {
    const mistaken = rowFromItemsObject(data.items, data.product, data.stage);
    if (mistaken) {
      return {
        ...mistaken,
        promoShown: normalizePromoShown(data.promo_shown ?? data.promoShown),
        customerData: normalizeCustomerData(data.customer_data ?? data.customerData),
        recommendedSize: normalizeRecommendedSizeField(data.recommended_size ?? data.recommendedSize),
        pendingMessage,
        botPaused,
        lastOrphanQty,
        messages: persistedChat,
      };
    }
  }

  if (data.messages != null && persistedChat.length === 0) {
    const legacy = legacyFromMessages(data.messages);
    if (legacy) return { ...legacy, pendingMessage, botPaused, lastOrphanQty, messages: [] };
  }

  return {
    product: data.product ?? null,
    items: [],
    sizeCandidates: normalizeSizeCandidates(data.size_candidates ?? data.sizeCandidates),
    promoShown: normalizePromoShown(data.promo_shown ?? data.promoShown),
    customerData: normalizeCustomerData(data.customer_data ?? data.customerData),
    recommendedSize: normalizeRecommendedSizeField(data.recommended_size ?? data.recommendedSize),
    stage: data.stage ?? "exploration",
    pendingMessage,
    botPaused,
    lastOrphanQty,
    messages: persistedChat,
  };
}

function serializeMessagesForDb(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const row of messages) {
    if (!row || typeof row !== "object") continue;
    const role = row.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = row.content != null ? String(row.content) : "";
    if (!String(content).trim()) continue;
    out.push({ role, content: content.slice(0, 50000) });
  }
  return out.slice(-20);
}

function rowForUpsert(state) {
  const product = state?.product ?? null;
  const items = normalizeItemsArray(state?.items);
  const stage = state?.stage ?? "exploration";
  const size_candidates = normalizeSizeCandidates(state?.sizeCandidates);
  const promo_shown = normalizePromoShown(state?.promoShown);
  const customer_data = normalizeCustomerData(state?.customerData);
  const recommended_size = normalizeRecommendedSizeField(state?.recommendedSize);
  const last_orphan_qty = normalizeLastOrphanQtyField(state?.lastOrphanQty);
  const messages = serializeMessagesForDb(state?.messages);
  return { product, items, stage, size_candidates, promo_shown, customer_data, recommended_size, last_orphan_qty, messages };
}

/**
 * Persiste `size_candidates` (jsonb), `promo_shown` (bool), `customer_data` (jsonb), `recommended_size` (text).
 * Si faltan columnas:
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS size_candidates jsonb DEFAULT '[]'::jsonb;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS promo_shown boolean DEFAULT false;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS customer_data jsonb DEFAULT '{}'::jsonb;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS recommended_size text DEFAULT NULL;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pending_message jsonb DEFAULT NULL;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS bot_paused boolean DEFAULT false;
 * ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_orphan_qty integer DEFAULT NULL;
 * La columna `messages` (jsonb) puede guardar historial Anthropic [{ role, content }, ...] (últimos 20 al guardar).
 */
export async function saveSession(sessionId, state) {
  const supabase = getSupabase();
  const row = rowForUpsert(state);
  const { error } = await supabase.from("sessions").upsert({
    id: sessionId,
    product: row.product,
    items: row.items,
    stage: row.stage,
    size_candidates: row.size_candidates,
    promo_shown: row.promo_shown,
    customer_data: row.customer_data,
    recommended_size: row.recommended_size,
    last_orphan_qty: row.last_orphan_qty,
    messages: row.messages,
    updated_at: new Date().toISOString(),
  });
  if (error) throw toError(error);
}

export async function getSession(sessionId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("sessions")
    .select(
      "product, items, stage, size_candidates, promo_shown, customer_data, recommended_size, last_orphan_qty, messages, pending_message, bot_paused"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw toError(error);
  return normalizeRow(data);
}

/**
 * Sesiones con `updated_at` en las últimas 24 h (máx. 50), más recientes primero.
 * Incluye columnas para listado y detalle en el panel.
 */
export async function getActiveSessions() {
  const supabase = getSupabase();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .select("id, messages, customer_data, updated_at, bot_paused, items, stage, product")
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw toError(error);
  const rows = Array.isArray(data) ? data : [];
  return rows.map((row) => {
    const norm = normalizeRow(row);
    return {
      id: row.id,
      updatedAt: row.updated_at ?? null,
      botPaused: normalizeBotPaused(row.bot_paused),
      customerData: norm?.customerData ?? {},
      stage: norm?.stage ?? "exploration",
      items: norm?.items ?? [],
      product: norm?.product ?? null,
    };
  });
}

export async function setSessionBotPaused(sessionId, botPaused) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .update({ bot_paused: !!botPaused, updated_at: now })
    .eq("id", sessionId)
    .select("id")
    .maybeSingle();
  if (error) throw toError(error);
  if (!data) {
    const err = new Error("Sesión no encontrada");
    err.code = "SESSION_NOT_FOUND";
    throw err;
  }
}

/**
 * Solo actualiza `pending_message` (buffer corto WhatsApp). INSERT mínimo si no existe fila.
 */
export async function setSessionPendingMessage(sessionId, pendingMessage) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data: row, error: selErr } = await supabase.from("sessions").select("id").eq("id", sessionId).maybeSingle();
  if (selErr) throw toError(selErr);

  if (row) {
    const { error } = await supabase
      .from("sessions")
      .update({ pending_message: pendingMessage, updated_at: now })
      .eq("id", sessionId);
    if (error) throw toError(error);
    return;
  }

  const { error } = await supabase.from("sessions").insert({
    id: sessionId,
    product: null,
    items: [],
    stage: "exploration",
    size_candidates: [],
    promo_shown: false,
    customer_data: {},
    recommended_size: null,
    last_orphan_qty: null,
    messages: [],
    pending_message: pendingMessage,
    updated_at: now,
  });
  if (error) throw toError(error);
}

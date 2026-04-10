import { getSupabase } from "./supabase.js";

const VALID_SIZES = new Set(["S", "M", "L", "XL"]);

function normalizeSizeKey(k) {
  const u = String(k).trim().toUpperCase();
  return VALID_SIZES.has(u) ? u : null;
}

function legacyFromMessages(msg) {
  if (!msg || typeof msg !== "object") return null;
  if (Array.isArray(msg.items)) {
    return {
      product: msg.product ?? null,
      items: normalizeItemsArray(msg.items),
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
    stage: stage ?? "exploration",
  };
}

function normalizeRow(data) {
  if (!data || typeof data !== "object") return null;

  if (Array.isArray(data.items)) {
    return {
      product: data.product ?? null,
      items: normalizeItemsArray(data.items),
      stage: data.stage ?? "exploration",
    };
  }

  if (data.items != null && typeof data.items === "object" && !Array.isArray(data.items)) {
    const mistaken = rowFromItemsObject(data.items, data.product, data.stage);
    if (mistaken) return mistaken;
  }

  if (data.messages != null) {
    return legacyFromMessages(data.messages);
  }

  return {
    product: data.product ?? null,
    items: [],
    stage: data.stage ?? "exploration",
  };
}

function rowForUpsert(state) {
  const product = state?.product ?? null;
  const items = normalizeItemsArray(state?.items);
  const stage = state?.stage ?? "exploration";
  return { product, items, stage };
}

export async function saveSession(sessionId, state) {
  const supabase = getSupabase();
  const row = rowForUpsert(state);
  const { error } = await supabase.from("sessions").upsert({
    id: sessionId,
    product: row.product,
    items: row.items,
    stage: row.stage,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getSession(sessionId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("sessions")
    .select("product, items, stage, messages")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return normalizeRow(data);
}

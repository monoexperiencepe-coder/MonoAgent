import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { generateResponse } from "./src/services/aiService.js";
import { getSession, saveSession, mergeItems } from "./src/lib/sessions.js";
import { httpErrorMessage, toError } from "./src/lib/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const WORD_NUM = {
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
};

function parseQtyToken(tok) {
  if (/^\d+$/.test(tok)) return parseInt(tok, 10);
  const w = WORD_NUM[String(tok).toLowerCase()];
  return w ?? null;
}

function normSizeToken(tok) {
  const t = String(tok).toLowerCase();
  if (t === "xl") return "XL";
  if (t === "s" || t === "m" || t === "l") return t.toUpperCase();
  return null;
}

const QTY_WORD = String.raw`(\d+|uno|dos|tres|cuatro|cinco|seis)`;
const SIZE_ALT = String.raw`(xl|s|m|l)`;

/** Si el mensaje indica cambio de idea, vaciar items antes de aplicar extractItems (reemplazo total). */
const REPLACE_KEYWORDS = [
  "mejor",
  "en realidad",
  "cambia",
  "modifica",
  "quiero que sean",
  "que sean mejor",
  "no dame",
  "no, dame",
  "olvida",
  "mejor ponme",
  "mejor son",
  "mejor quiero",
];

/**
 * Orden fijo; cada fase consume spans en `working` para evitar doble conteo.
 * 1) N en (talla)? talla
 * 2) talla x cantidad
 * 3) N+talla pegado (solo dígitos)
 * 4) cantidad + talla separados (lookahead anti "2 modelos")
 * 5) fallback: solo talla → qty 1
 */
function extractItems(message) {
  const orig = String(message).trim().toLowerCase();
  let working = orig;
  const map = new Map();

  function add(sizeTok, qtyTok) {
    const size = normSizeToken(sizeTok);
    const qty = typeof qtyTok === "number" ? qtyTok : parseQtyToken(String(qtyTok));
    if (!size || qty == null || qty < 1) return;
    map.set(size, (map.get(size) || 0) + qty);
  }

  function runPhase(source, onMatch) {
    for (let guard = 0; guard < 64; guard++) {
      const re = new RegExp(source, "gi");
      const m = re.exec(working);
      if (!m) break;
      onMatch(m);
      working = working.slice(0, m.index) + " ".repeat(m[0].length) + working.slice(m.index + m[0].length);
    }
  }

  runPhase(String.raw`(\d+)\s+en\s+(?:talla\s+)${SIZE_ALT}\b`, (m) => add(m[2], m[1]));
  runPhase(String.raw`(\d+)\s+en\s+${SIZE_ALT}\b`, (m) => add(m[2], m[1]));

  runPhase(String.raw`\b${SIZE_ALT}\s*[x×]\s*${QTY_WORD}\b`, (m) => add(m[1], m[2]));

  runPhase(String.raw`\b(\d+)${SIZE_ALT}\b`, (m) => add(m[2], parseInt(m[1], 10)));

  runPhase(String.raw`(^|\s)${QTY_WORD}\s+${SIZE_ALT}(?=\s|$|[,.]|\s+y\b)`, (m) => add(m[3], m[2]));

  if (map.size === 0) {
    const solo = orig.match(/^\s*(xl|s|m|l)\s*$/i);
    if (solo) add(solo[1], 1);
    else {
      const ph = orig.match(/\btallas?\s*[:\s]*\b(xl|s|m|l)\b/i);
      if (ph) add(ph[1], 1);
    }
  }

  const order = ["S", "M", "L", "XL"];
  return [...map.entries()]
    .map(([size, qty]) => ({ size, qty }))
    .sort((a, b) => order.indexOf(a.size) - order.indexOf(b.size));
}

/**
 * Cantidad sin talla en el mismo mensaje (ej. "dame 3" tras haber dicho "talla m").
 * Solo si extractItems no encontró líneas; no usar si ya hay talla en el texto.
 */
function extractOrphanQuantity(message) {
  const s = String(message).trim().toLowerCase();
  if (!s) return null;
  const q = String.raw`(\d+|uno|dos|tres|cuatro|cinco|seis)`;
  const verbRe = new RegExp(
    String.raw`\b(?:dame|quiero|necesito|envíame|envia|mándame|mandame|pónme|ponme|deme)\s+${q}\b`
  );
  const m1 = s.match(verbRe);
  if (m1) return parseQtyToken(m1[1]);
  const sonRe = new RegExp(String.raw`^\s*son\s+${q}\s*[!?.]*\s*$`);
  const m2 = s.match(sonRe);
  if (m2) return parseQtyToken(m2[1]);
  const soloRe = new RegExp(String.raw`^\s*${q}\s*[!?.]*\s*$`);
  const m3 = s.match(soloRe);
  if (m3) return parseQtyToken(m3[1]);
  return null;
}

function normalizeSessionSizeToken(v) {
  if (v == null || v === "") return null;
  return normSizeToken(String(v));
}

/** Una sola talla implícita: sizeCandidates con un elemento, o un único size en items con qty > 0. */
function uniqueImpliedSize(session) {
  const c = session.sizeCandidates;
  if (Array.isArray(c) && c.length === 1) {
    const one = normalizeSessionSizeToken(c[0]);
    if (one) return one;
  }
  const lines = (session.items || []).filter((i) => Number(i.qty) > 0);
  const sizes = [...new Set(lines.map((i) => normalizeSessionSizeToken(i.size)).filter(Boolean))];
  if (sizes.length === 1) return sizes[0];
  return null;
}

/**
 * Talla implícita para cantidad huérfana ("dame 3"): con carrito vacío prioriza
 * session.recommendedSize (última recomendación del asistente); si no, sizeCandidates / items.
 */
function orphanImpliedSize(session) {
  if (!hasLineItems(session)) {
    const rec = normalizeSessionSizeToken(session.recommendedSize);
    if (rec) return rec;
  }
  return uniqueImpliedSize(session);
}

/** Si el asistente menciona exactamente una talla como recomendación, devolverla; si no, null. */
function extractRecommendedSizeFromReply(reply) {
  const t = String(reply).toLowerCase();
  const found = new Set();
  const sz = String.raw`(xl|s|m|l)\b`;
  const sources = [
    String.raw`\btallas?\s+${sz}`,
    String.raw`\buna\s+${sz}`,
    String.raw`\bun\s+${sz}`,
    String.raw`(?:te\s+recomiendo|recomiendo|te\s+qued[aá]|te\s+ir[ií]a)\s+(?:mejor\s+)?(?:la\s+|el\s+|talla\s+)?${sz}`,
    String.raw`(?:perfecta|perfecto|ideal|mejor)\s+(?:ser[ií]a\s+)?(?:la\s+|el\s+|talla\s+)?${sz}`,
    String.raw`(?:la\s+|el\s+|talla\s+)${sz}(?:\s+te\s+queda|\s+te\s+va|\s+es\s+tu\s+talla)`,
  ];
  for (const src of sources) {
    const re = new RegExp(src, "gi");
    let m;
    while ((m = re.exec(t)) !== null) {
      const k = normSizeToken(m[1]);
      if (k) found.add(k);
    }
  }
  if (found.size === 1) return [...found][0];
  return null;
}

/** Sustituye la cantidad de esa talla (no suma con la anterior). Otras líneas se conservan. */
function replaceQtyForSingleSize(items, size, qty) {
  const sz = normalizeSessionSizeToken(size);
  if (!sz || qty == null || qty < 1) return mergeItems([], items || []);
  const rest = (items || []).filter((i) => normalizeSessionSizeToken(i.size) !== sz);
  return mergeItems([], [...rest, { size: sz, qty }]);
}

/**
 * Aplica líneas extraídas del mensaje: no sumar al carrito salvo "una talla nueva".
 * - Varias tallas en un solo mensaje → reemplaza todo el pedido (ej. "2L y 1M" sustituye "3L").
 * - Una sola talla que ya estaba en el carrito → sustituye solo esa línea (misma qty del mensaje, no acumulativa).
 * - Una sola talla nueva → suma al carrito (merge).
 */
function applyExtractedLineItems(session, incoming) {
  const cleaned = mergeItems([], incoming);
  if (!cleaned.length) return;
  session.recommendedSize = null;
  if (cleaned.length >= 2) {
    session.items = cleaned;
    return;
  }
  const one = cleaned[0];
  const sz = normalizeSessionSizeToken(one.size);
  const qty = Number(one.qty);
  if (!sz || !Number.isFinite(qty) || qty < 1) return;
  const prevSizes = new Set(
    (session.items || [])
      .filter((i) => Number(i.qty) > 0)
      .map((i) => normalizeSessionSizeToken(i.size))
  );
  if (!prevSizes.has(sz)) {
    session.items = mergeItems(session.items, cleaned);
  } else {
    session.items = replaceQtyForSingleSize(session.items, sz, qty);
  }
}

/** Indecisión entre tallas sin cantidades (ej. "m o l", "entre m y l"). Mínimo 2 tallas distintas. */
function detectSizeCandidates(m) {
  const lower = String(m).trim().toLowerCase();
  const sz = SIZE_ALT;
  const patterns = [
    String.raw`\btallas?\s+${sz}\s+(?:o|u|y)\s+${sz}\b`,
    String.raw`\b${sz}\s+(?:o|u|y)\s+${sz}\b`,
    String.raw`\bentre\s+(?:la\s+)?${sz}\s+y\s+(?:la\s+)?${sz}\b`,
  ];
  const found = new Set();
  for (const p of patterns) {
    const re = new RegExp(p, "gi");
    let ma;
    while ((ma = re.exec(lower)) !== null) {
      for (let i = 1; i < ma.length; i++) {
        if (ma[i]) {
          const k = normSizeToken(ma[i]);
          if (k) found.add(k);
        }
      }
    }
  }
  if (found.size < 2) return null;
  const order = ["S", "M", "L", "XL"];
  return [...found].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

function sessionFromStored(stored) {
  if (!stored) {
    return {
      product: null,
      items: [],
      sizeCandidates: [],
      stage: "exploration",
      promoShown: false,
      customerData: {},
      recommendedSize: null,
    };
  }
  const raw = Array.isArray(stored.items)
    ? stored.items.map((i) => ({ size: i.size, qty: Number(i.qty) }))
    : [];
  const items = mergeItems([], raw);
  const rawCand = stored.sizeCandidates ?? stored.size_candidates;
  const sizeCandidates = Array.isArray(rawCand) ? [...rawCand] : [];
  const promoRaw = stored.promoShown ?? stored.promo_shown;
  const rawCust = stored.customerData ?? stored.customer_data;
  const customerData =
    rawCust && typeof rawCust === "object" && !Array.isArray(rawCust) ? { ...rawCust } : {};
  const recRaw = stored.recommendedSize ?? stored.recommended_size;
  const recommendedSize = normalizeSessionSizeToken(recRaw) || null;
  return {
    product: stored.product ?? null,
    items,
    sizeCandidates,
    stage: stored.stage ?? "exploration",
    promoShown: promoRaw === true || promoRaw === 1 || promoRaw === "true",
    customerData,
    recommendedSize,
  };
}

function hasLineItems(session) {
  return Array.isArray(session.items) && session.items.some((i) => Number(i.qty) > 0);
}

function totalItemQty(session) {
  return (session.items || []).reduce((s, i) => {
    const q = Number(i.qty);
    return s + (Number.isFinite(q) && q > 0 ? q : 0);
  }, 0);
}

/** Precio total en soles para N polos (N = suma de cantidades del pedido). */
function calcPrice(n) {
  const N = Number(n);
  if (!Number.isFinite(N) || N < 1) return null;
  if (N === 1) return 60;
  if (N === 2) return 110;
  if (N >= 3) return 150 + (N - 3) * 30;
  return null;
}

function formatItemsHuman(items) {
  if (!Array.isArray(items) || !items.length) return "ninguna línea todavía";
  const order = ["S", "M", "L", "XL"];
  const rows = items
    .filter((i) => Number(i.qty) > 0)
    .sort((a, b) => order.indexOf(a.size) - order.indexOf(b.size));
  return rows.map((i) => `${i.qty} ${i.size}`).join(" y ");
}

/** Desglose línea por línea para el prompt (anti-confusión 2M+1L vs 3M). */
function formatOrderLockBlock(session) {
  const merged = mergeItems([], session.items || []);
  const rows = merged.filter((i) => Number(i.qty) > 0);
  if (!rows.length) return "";
  const order = ["S", "M", "L", "XL"];
  rows.sort((a, b) => order.indexOf(a.size) - order.indexOf(b.size));
  const lines = rows.map((i) => {
    const n = Number(i.qty);
    const unit = n === 1 ? "unidad" : "unidades";
    return `- ${n} ${unit} talla ${i.size}`;
  });
  const total = rows.reduce((s, i) => s + Number(i.qty), 0);
  const poloWord = total === 1 ? "polo" : "polos";
  return `PEDIDO CONFIRMADO POR EL CLIENTE (no cambiar):
${lines.join("\n")}
- Total: ${total} ${poloWord}
PROHIBIDO cambiar estas cantidades ni estas tallas. En confirmaciones y resúmenes usa EXACTAMENTE este desglose; no agrupes tallas distintas en una sola ni inventes otras cifras.`;
}

function trimStr(s) {
  if (s == null) return "";
  return String(s).replace(/\s+/g, " ").trim();
}

function mergeCustomerData(prev, patch) {
  const base = prev && typeof prev === "object" ? { ...prev } : {};
  for (const k of ["name", "dni", "address", "city"]) {
    const v = patch[k];
    if (v != null && trimStr(v) !== "") base[k] = trimStr(v);
  }
  return base;
}

function normalizeForCityLookup(s) {
  return trimStr(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Clave ASCII minúscula → etiqueta para customerData.city */
const PE_DESTINATION_LABEL = new Map([
  ["lima", "Lima"],
  ["cusco", "Cusco"],
  ["cuzco", "Cusco"],
  ["arequipa", "Arequipa"],
  ["trujillo", "Trujillo"],
  ["piura", "Piura"],
  ["ica", "Ica"],
  ["puno", "Puno"],
  ["tacna", "Tacna"],
  ["huancayo", "Huancayo"],
  ["chiclayo", "Chiclayo"],
  ["iquitos", "Iquitos"],
  ["ayacucho", "Ayacucho"],
  ["huaraz", "Huaraz"],
  ["cajamarca", "Cajamarca"],
  ["tarapoto", "Tarapoto"],
  ["pucallpa", "Pucallpa"],
  ["tumbes", "Tumbes"],
  ["moquegua", "Moquegua"],
  ["pasco", "Pasco"],
  ["callao", "Callao"],
  ["lambayeque", "Lambayeque"],
  ["chimbote", "Chimbote"],
  ["juliaca", "Juliaca"],
  ["sullana", "Sullana"],
  ["talara", "Talara"],
  ["abancay", "Abancay"],
  ["huancavelica", "Huancavelica"],
  ["tingo maria", "Tingo María"],
  ["puerto maldonado", "Puerto Maldonado"],
  ["la libertad", "La Libertad"],
  ["san martin", "San Martín"],
  ["madre de dios", "Madre de Dios"],
  ["surco", "Surco"],
  ["santiago de surco", "Santiago de Surco"],
  ["miraflores", "Miraflores"],
  ["san isidro", "San Isidro"],
  ["barranco", "Barranco"],
  ["la molina", "La Molina"],
  ["los olivos", "Los Olivos"],
  ["jesus maria", "Jesús María"],
  ["san borja", "San Borja"],
  ["san miguel", "San Miguel"],
  ["magdalena", "Magdalena"],
  ["pueblo libre", "Pueblo Libre"],
  ["chorrillos", "Chorrillos"],
  ["rimac", "Rímac"],
  ["comas", "Comas"],
  ["independencia", "Independencia"],
  ["ate", "Ate"],
  ["vitarte", "Vitarte"],
  ["sjl", "San Juan de Lurigancho"],
  ["sjm", "San Juan de Miraflores"],
  ["san juan de lurigancho", "San Juan de Lurigancho"],
  ["san juan de miraflores", "San Juan de Miraflores"],
  ["santa anita", "Santa Anita"],
  ["lince", "Lince"],
  ["san luis", "San Luis"],
  ["villa maria del triunfo", "Villa María del Triunfo"],
  ["villa el salvador", "Villa El Salvador"],
  ["carabayllo", "Carabayllo"],
  ["puente piedra", "Puente Piedra"],
  ["ancon", "Ancón"],
  ["chaclacayo", "Chaclacayo"],
  ["cieneguilla", "Cieneguilla"],
  ["lurin", "Lurín"],
  ["pachacamac", "Pachacamac"],
]);

const NOT_STANDALONE_CITY = new Set([
  "dame",
  "quiero",
  "son",
  "talla",
  "hola",
  "gracias",
  "ok",
  "si",
  "yes",
  "no",
  "buenos",
  "dias",
  "tres",
  "dos",
  "uno",
  "cuatro",
  "cinco",
  "seis",
  "polo",
  "polos",
  "envio",
  "envío",
  "pago",
  "yape",
  "efectivo",
]);

/**
 * Ciudad o distrito (Lima) cuando el cliente responde solo con el nombre, p. ej. "cusco", "surco".
 */
function extractPlainDestinationCity(raw, patch) {
  if (patch.city) return;
  if (!raw || /\d/.test(raw)) return;
  const words = trimStr(raw).split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 3) return;
  const key = normalizeForCityLookup(raw);
  if (!key || NOT_STANDALONE_CITY.has(key)) return;
  if (/\b(?:talla|dame|quiero|son|necesito|pack|polo)\b/i.test(raw)) return;
  if (/\b(?:xl|s|m|l)\b/i.test(key) && /\b(?:y|en|talla)\b/.test(key)) return;
  const label = PE_DESTINATION_LABEL.get(key);
  if (label) {
    patch.city = label;
  }
}

/**
 * Extrae fragmentos de datos del cliente; se fusiona en varios mensajes seguidos.
 * Usa el texto original (mayúsculas) para nombres y direcciones.
 */
function extractCustomerDataPatch(message) {
  const raw = trimStr(message);
  const patch = {};
  if (!raw) return patch;

  const dniM = raw.match(/\b(\d{8})\b/);
  if (dniM) patch.dni = dniM[1];

  const nameIntro = raw.match(
    /(?:^|[.!?]\s*|\n)(?:me\s+llamo|soy|mi\s+nombre\s+es|nombre\s*:)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ'.-]+){0,4})/i
  );
  if (nameIntro) patch.name = trimStr(nameIntro[1]);

  const addrKw = raw.match(
    /(?:direcci[oó]n\s*:?|vivo\s+en|env[íi]o\s+a|envio\s+a|mi\s+direcci[oó]n\s+es|mando\s+a|quedo\s+en|estoy\s+en)\s+([^\n]+?)(?=\s*(?:,|;|\n|dni\b|celular)|$)/i
  );
  if (addrKw) {
    let a = trimStr(addrKw[1]);
    a = a.replace(/\s*dni\s*:?\s*\d{8}.*$/i, "").trim();
    if (a) patch.address = a;
  }

  const cityM = raw.match(
    /(?:ciudad|distrito)\s*:?\s*([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ\s.]+?)(?=\s*[,.;\n]|$)/i
  );
  if (cityM) patch.city = trimStr(cityM[1]);

  if (!patch.city) {
    const tail = raw.match(/,\s*(Lima|Callao|Surco|Miraflores|San Isidro|Barranco|La Molina)\b/i);
    if (tail) patch.city = trimStr(tail[1]);
  }

  const commaParts = raw.split(",").map((p) => trimStr(p)).filter(Boolean);
  if (commaParts.length >= 2) {
    for (const p of commaParts) {
      if (/^\d{8}$/.test(p)) patch.dni = patch.dni || p;
    }
    if (!patch.name) {
      const first = commaParts[0];
      if (
        /^[A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ'.-]+)+$/.test(first) &&
        first.length <= 80 &&
        !/\d/.test(first)
      ) {
        patch.name = first;
      }
    }
    if (!patch.address) {
      for (const p of commaParts) {
        if (
          /\b(?:xl|s|m|l)\b/i.test(p) &&
          /\d/.test(p) &&
          /\b(?:y|en|talla)\b/i.test(p.toLowerCase())
        ) {
          continue;
        }
        if (
          /\d/.test(p) &&
          /[A-Za-záéíóúñ]{2,}/i.test(p) &&
          !/^\d{8}$/.test(p) &&
          p !== patch.name &&
          p !== patch.city
        ) {
          patch.address = p;
          break;
        }
      }
    }
    if (!patch.city && commaParts.length >= 2) {
      const last = commaParts[commaParts.length - 1];
      if (
        /^[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ\s]*$/.test(last) &&
        last.length < 50 &&
        !/^\d{8}$/.test(last) &&
        last !== patch.name &&
        last !== patch.address
      ) {
        patch.city = last;
      }
    }
  }

  extractPlainDestinationCity(raw, patch);

  const badNames = /^(uno|dos|tres|cuatro|cinco|seis|s|m|l|xl)$/i;
  if (patch.name && badNames.test(patch.name)) delete patch.name;

  return patch;
}

function formatCustomerDataBlock(cd) {
  if (!cd || typeof cd !== "object") return "";
  const parts = [];
  if (cd.name) parts.push(`Nombre: ${cd.name}`);
  if (cd.dni) parts.push(`DNI: ${cd.dni}`);
  if (cd.address) parts.push(`Dirección: ${cd.address}`);
  if (cd.city) parts.push(`Ciudad: ${cd.city}`);
  if (!parts.length) return "";
  const cityNote = cd.city
    ? `\n\nCiudad/destino ya confirmado: ${cd.city} — NO volver a preguntar por ciudad o departamento de destino`
    : "";
  return `DATOS DEL CLIENTE YA CONFIRMADOS (no volver a pedir de nuevo lo que ya aparece abajo):
${parts.join("\n")}${cityNote}`;
}

function recomputeStage(session) {
  if (!session.product) {
    session.stage = "exploration";
    return;
  }
  if (!hasLineItems(session)) {
    session.stage = "interest";
    return;
  }
  if (totalItemQty(session) >= 2) {
    session.stage = "closing";
  } else {
    session.stage = "intention";
  }
}

function updateSession(session, message) {
  const m = String(message).trim().toLowerCase();

  if (!session.product && m.includes("high cotton")) {
    session.product = "high_cotton";
  }

  if (!Array.isArray(session.items)) {
    session.items = [];
  }
  if (!Array.isArray(session.sizeCandidates)) {
    session.sizeCandidates = [];
  }

  const incoming = extractItems(message);
  if (incoming.length > 0) {
    const isReplaceIntent = REPLACE_KEYWORDS.some((k) => m.includes(k));
    if (isReplaceIntent) {
      session.items = [];
    }
    applyExtractedLineItems(session, incoming);
    session.sizeCandidates = [];
  } else if (session.product) {
    const orphan = extractOrphanQuantity(message);
    if (orphan != null && orphan >= 1) {
      const implied = orphanImpliedSize(session);
      if (implied) {
        session.items = replaceQtyForSingleSize(session.items, implied, orphan);
        session.sizeCandidates = [];
        session.recommendedSize = null;
      }
    }
    if (!hasLineItems(session)) {
      const cand = detectSizeCandidates(m);
      if (cand && cand.length >= 2) {
        session.sizeCandidates = cand;
      }
    }
  }

  session.items = mergeItems([], session.items);

  if (!session.customerData || typeof session.customerData !== "object") {
    session.customerData = {};
  }
  const custPatch = extractCustomerDataPatch(String(message).trim());
  session.customerData = mergeCustomerData(session.customerData, custPatch);

  recomputeStage(session);

  console.log("[SESSION] Estado actualizado:", session);
}

function sessionStateForPrompt(session) {
  const cd = session.customerData && typeof session.customerData === "object" ? session.customerData : {};
  const rec = normalizeSessionSizeToken(session.recommendedSize) || null;
  return {
    product: session.product,
    items: session.items,
    sizeCandidates: Array.isArray(session.sizeCandidates) ? session.sizeCandidates : [],
    stage: session.stage,
    promoShown: !!session.promoShown,
    customerData: { ...cd },
    recommendedSize: rec,
  };
}

function buildSessionSystemAugmentation(session) {
  const lines = formatItemsHuman(session.items);
  const orderLock = hasLineItems(session) ? formatOrderLockBlock(session) : "";
  const custBlock = formatCustomerDataBlock(
    session.customerData && typeof session.customerData === "object" ? session.customerData : {}
  );
  const cand = Array.isArray(session.sizeCandidates) ? session.sizeCandidates : [];
  const candLine =
    cand.length >= 2
      ? `El cliente está evaluando entre las tallas: ${cand.join(", ")} — ayúdalo a decidir, NO muestres el catálogo general`
      : "";
  const recSz = normalizeSessionSizeToken(session.recommendedSize);
  const recommendedLine =
    recSz && !hasLineItems(session)
      ? `Talla recomendada al cliente: ${recSz} — si el cliente confirma cantidad sin mencionar talla, usar esta talla al registrar items.`
      : "";
  const hasSizeAndQty = hasLineItems(session);
  const promoRules = session.promoShown
    ? `PROMOS (promoShown=true) — REGLA DURA:
* Está ABSOLUTAMENTE PROHIBIDO mostrar el bloque de promos (listados tipo "2 x S/110", "3 x S/150", packs en formato lista, tablas de precios promocionales, bienvenida comercial repetida) en **cualquier** mensaje.
* Si promoShown = true: **no escribas** "2 x S/110" ni "3 x S/150" ni ningún bloque de precios en formato lista de promos.
* Solo menciona precio como **total del pedido** cuando el cliente ya tiene talla y cantidad en items[] confirmados — usa la fórmula / PRECIO VERIFICADO de abajo para ese total único, no listas de packs.
* Si el cliente no pide explícitamente precios o promos, no listes promos ni packs.`
    : "";
  const priceRules = hasSizeAndQty
    ? `PRECIOS: El cliente ya tiene talla y cantidad en items[] — indica el total con la fórmula y la cifra verificada de abajo (misma lógica que calcPrice(N)).`
    : `PRECIOS: NO muestres precio total ni tablas de promos todavía — aún no hay talla y cantidad en items[]; pregunta solo lo que falte para completar el pedido.`;
  const totalN = hasSizeAndQty ? totalItemQty(session) : 0;
  const verifiedTotal = hasSizeAndQty && totalN > 0 ? calcPrice(totalN) : null;
  const priceVerifiedLine =
    verifiedTotal != null
      ? `PRECIO VERIFICADO PARA ESTE PEDIDO: N = ${totalN} polo(s) en total (suma de qty en items[]) → S/${verifiedTotal}. Di al cliente exactamente S/${verifiedTotal} como total; coincide con calcPrice(${totalN}).`
      : "";
  const packPriceTable = `TABLA DE PRECIOS (soles; N = cantidad total de polos = suma de todas las qty en items[]):

| N polos | Precio total |
|---------|----------------|
| 1       | S/60           |
| 2       | S/110          |
| 3       | S/150          |
| 4       | S/180          |
| 5       | S/210          |
| 6       | S/240          |
| 7       | S/270          |

REGLA DE CÁLCULO (obligatoria):
* N = 1 → S/60
* N = 2 → S/110
* N ≥ 3 → precio = 150 + (N − 3) × 30  (base del pack de 3 a S/150, más S/30 por cada polo adicional sobre los 3)

EJEMPLOS EXPLÍCITOS:
* 4 polos = S/150 + S/30 = S/180
* 5 polos = S/150 + S/60 = S/210
* 6 polos = S/150 + S/90 = S/240
* 7 polos = S/150 + S/120 = S/270

PROHIBIDO: usar S/155, S/185, S/219.90 u otras cifras antiguas — **no existen** en esta política.
* Packs mixtos (varias tallas): un solo N (total de unidades), una sola aplicación de la fórmula; no sumes precios de “packs” distintos de forma incorrecta.
* Para cualquier N ≥ 1 entero, el total es el resultado de la fórmula anterior (equivalente a calcPrice(N) en código).`;
  return `

ESTADO ACTUAL DEL CLIENTE (JSON; items[] = una entrada por talla, sin colapsar):
${JSON.stringify(sessionStateForPrompt(session))}

${orderLock ? `${orderLock}\n\n` : ""}Desglose obligatorio (repite tal cual en confirmaciones; formato compacto tipo "2 M y 1 L"):
${lines}

${custBlock ? `${custBlock}\n\n` : ""}${recommendedLine ? `${recommendedLine}\n\n` : ""}${candLine ? `${candLine}\n` : ""}

${promoRules ? `${promoRules}\n\n` : ""}${priceRules}

${packPriceTable}

${priceVerifiedLine ? `${priceVerifiedLine}\n` : ""}
PRODUCTO ÚNICO:
* Solo vendemos el Oversize High Cotton Ultra Grueso 11/1 en negro
* NUNCA ofrezcas otros productos ni otras líneas
* NO repitas el nombre del producto en cada mensaje — el cliente ya sabe qué está comprando

FLUJO DE CONVERSACIÓN:
* Si promoShown es false en el JSON: primera respuesta puede ser bienvenida breve + promos completas una sola vez + pregunta por talla
* Si promoShown es true en el JSON: cero listas de promos / "2 x S/110" en el chat; solo total de pedido cuando items[] ya tiene talla+cantidad (ver PROMOS arriba)
* Una vez el cliente indica talla (o está clara en el estado): pregunta SOLO por cantidad
* Una vez tienes talla y cantidad en items[]: di el precio total y pide datos de envío; el pago lo defines en cierre según FLUJO DE PAGO (Lima vs provincia)
* NO repitas las promos en cada mensaje
* NO repitas el nombre del producto en cada mensaje
* NO digas "delivery gratis" en cada mensaje de forma repetida — úsalo al confirmar el pedido final **o** en el empujón de cierre del apartado EMPUJÓN DE CIERRE (una sola mención, tono natural)

SECUENCIA IDEAL:
1. Bienvenida + promos + pregunta talla → una sola vez
2. Cliente da talla → pregunta cantidad directamente
3. Cliente da cantidad → di precio total y pregunta datos de envío
4. Cliente da datos → confirma el pedido y cierra según FLUJO DE PAGO (Lima vs provincia); no mezcles instrucciones contradictorias

Si el cliente hace preguntas intermedias (envíos, colores, materiales, tiempos, etc.), respóndela de forma puntual. Si además ya hay talla y cantidad en items[], aplica siempre el empujón de cierre del apartado EMPUJÓN DE CIERRE.

FLUJO DE PAGO (obligatorio; usa customerData.city y el contexto del cliente para decidir Lima vs provincia):

LIMA (incluye distritos de Lima Metropolitana; entrega local):
* Pago por defecto: CONTRA ENTREGA (paga al recibir). No pidas adelanto ni Yape salvo que el cliente pregunte por ello.
* Cuando el cliente confirme su método de pago (Yape, efectivo, etc.) **sin** haber pedido antes el número de Yape, responde SOLO con este cierre (puedes adaptar mínimamente el tono, no añadas datos de pago):
  "Perfecto, hemos registrado tu pedido. Nos comunicaremos contigo para coordinar la entrega. ¡Gracias por tu compra! 🙌"
* Si el cliente de Lima pregunta explícitamente por el número de Yape (ej.: "¿cuál es el número de Yape?", "¿a qué número te mando?" o similar): responde directo, sin rodeos: "Al 979 400 295 a nombre de Alejandro Aguilar 👌"
* **Después de dar el número de Yape en Lima:** no repitas preguntas de si está "listo para pagar" u otras redundantes; cierra de forma breve, por ejemplo: "Perfecto, quedo atento 🙌"
* Lima es contra entrega por defecto; si el cliente quiere pagar antes por Yape, dar el número sin problema cuando lo pida explícitamente (mismo número arriba).
* NUNCA pidas comprobante ni captura de pago en Lima — es contra entrega; paga al recibir.

PROVINCIA (fuera de Lima Metropolitana):
* Se coordina pago por adelantado y envío; no asumas contra entrega.
* Si el cliente dice "por Yape", "pago por Yape", "te pago por yape" u otra intención de pagar por Yape **pero aún no confirma que va a pagar en ese momento**: **NO des el número de Yape de inmediato**. Primero confirma el monto del adelanto (usa el total S/ del bloque PRECIO VERIFICADO / calcPrice cuando ya hay pedido) con algo como: "Perfecto, el adelanto es S/[monto]. ¿Estás listo para realizar el pago ahora?"
* El número de Yape **solo** después de que el cliente confirme que va a pagar ahora: "sí", "listo", "ya", "dale", "confirmo", "dame el número", "pásame el yape", "¿a qué número?", etc. Ahí sí envías el número (979 400 295 a nombre de Alejandro Aguilar, salvo que FAQs indiquen otro).
* **Después de haber enviado el número de Yape en provincia** (el cliente ya pidió número o confirmó que paga): **NO** vuelvas a preguntar "¿Estás listo para realizar el pago ahora?" — ya es obvio que va a pagar. Cierra con el resumen del pedido y, por ejemplo: "Tu pedido sigue apartado: [resumen]. Quedo atento al comprobante 👀"
* Si el cliente dice "ya pagué", "hice el pago", "ya te transferí", "listo el yape" o similar (pago ya hecho): **SÍ** pide la captura/comprobante para coordinar envío, con este tono (sustituye [ciudad] por customerData.city o el destino confirmado):
  "Perfecto 🙌 Por favor envíanos la captura del pago para coordinar el despacho a [ciudad]. Te confirmamos el código de seguimiento una vez verificado."
* Puedes combinar con el cierre de agradecimiento cuando corresponda, sin contradecir el pedido de captura en provincia.

REGLA GENERAL (pago y cierre):
* No mezcles en **un mismo mensaje** lógicas contradictorias (no digas "contra entrega" y en la misma respuesta mandar Yape como si fuera obligatorio el pago previo, ni mezclar cierre de Lima con flujo de provincia).
* En provincia sí está permitido dar el número de Yape en un **segundo** mensaje/paso, después de que el cliente confirme que está listo para pagar (no en el primer "por yape" impulsivo).
* El cierre del pedido sigue siendo: confirmar pedido + que nos comunicaremos cuando aplique; sin rodeos innecesarios.
* Si no sabes si es Lima o provincia, pregunta ciudad de envío antes de instrucciones de pago.

MULTI-TALLA / CANTIDAD SIN REPARTIR:
* Si el cliente pide **más** unidades (ej. "dame 4") y en el contexto ya hay **una talla clara** (items[], talla recomendada o una sola línea de talla), **no** preguntes "¿en qué tallas irían los otros X?" ni variantes dispersas.
* Pregunta de forma directa, por ejemplo: "¿Todos en talla M o prefieres mezclar con otra talla?" (adapta la letra M a la talla que corresponda según el estado).

EMPUJÓN DE CIERRE (preguntas neutras):
* Cuando el cliente haga una pregunta **neutral** (colores, materiales, tiempos de envío, cuidados, etc.) **y** el estado ya tenga **talla + cantidad** en items[], después de responder bien a la duda, añade **siempre** un cierre suave (no agresivo), por ejemplo:
  "Tu pedido está apartado: [resumen breve del desglose]. Delivery gratis incluido 🚚 ¿Lo confirmamos ahora?"
* Debe sonar natural; no presiones de más.

PROHIBIDO: sumar cantidades de tallas distintas y expresarlas como una sola talla (ej. NO "3 M" si en realidad es 2 M + 1 L).

REGLAS IMPORTANTES:

* Usa este estado para mantener contexto
* El estado actual (JSON y desglose arriba) siempre está visible para ti: úsalo para no repetir preguntas ya respondidas
* Si el cliente ya eligió talla (hay líneas en items[] con cantidades por talla), NUNCA volver a preguntar por talla
* Si session.product está definido, no presentes catálogo ni otras líneas (producto único; ver arriba)
* Si hay cantidades en items[], no vuelvas a ofrecer bloques de promos salvo que pregunten explícitamente por precios (ver FLUJO DE CONVERSACIÓN)
* Si promoShown es true: jamás listas tipo "2 x S/110"; solo total del pedido con items[] (ver PROMOS)
* Cuando el cliente haga una pregunta fuera del flujo (envíos, pagos, colores), respóndela brevemente y RETOMA desde donde estaba la conversación con un resumen del pedido actual
* Si ya hay talla+cantidad en items[] y la pregunta es neutral, usa el empujón del apartado EMPUJÓN DE CIERRE (puede sustituir o complementar el formato de retoma clásico)
* Formato de retoma (si no aplicas el empujón largo): "Por cierto, tu pedido sigue apartado: [resumen] ¿Confirmamos?"
* NUNCA reiniciar la conversación si ya hay datos en el estado
* No cambies de producto si ya hay uno definido
* Cada elemento de items[] es independiente: nunca fusiones tallas ni redistribuyas cantidades entre tallas
* Si stage = "intention", enfócate en completar unidades y cerrar
* Si stage = "closing", confirma el pedido con el desglose por talla y aplica FLUJO DE PAGO (Lima vs provincia); en Lima no pidas comprobante; en provincia sí pide captura cuando digan que ya pagaron; Yape en provincia en dos pasos (confirmación antes del número)
* Si customerData en el JSON ya tiene campos rellenos, NO vuelvas a pedir esos datos de envío; solo pregunta lo que falte

COMPORTAMIENTO SEGÚN stage:

* exploration: orienta a talla; promos completas solo si promoShown es false (ver FLUJO DE CONVERSACIÓN)
* interest: responde de forma puntual; aún no hay líneas en items
* intention: hay líneas en items; refuerza mínimo de unidades si aplica
* closing: listo para cierre; confirma producto, tallas/cantidades y precio pack; cierra según FLUJO DE PAGO sin mezclar métodos

COHERENCIA DEL PRODUCTO (crítico):

* Si session.product ya existe: NO cambies a otra línea de producto
* NO muestres catálogo general ni mezcles otras líneas
* NO uses precios de otras líneas

ANTI-ALUCINACIÓN:

* No inventes materiales ni datos no indicados
* No menciones "algodón pima"
* Usa solo la información definida en tus instrucciones y FAQs
`.trim();
}

const app = express();
app.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json());

// Estáticos después del API. En Vercel el bundle suele no tener client/dist junto a __dirname;
// includeFiles en vercel.json + process.cwd() asegura la ruta correcta.
const distPath = existsSync(join(__dirname, "client/dist"))
  ? join(__dirname, "client/dist")
  : join(process.cwd(), "client/dist");

app.post("/chat", async (req, res) => {
  const { message, sessionId: bodySessionId, systemPrompt, faqs } = req.body ?? {};

  if (message === undefined || message === null || String(message).trim() === "") {
    return res.status(400).json({ error: "message es requerido" });
  }

  if (faqs !== undefined && !Array.isArray(faqs)) {
    return res.status(400).json({ error: "faqs debe ser un array" });
  }

  const trimmedMessage = String(message).trim();

  try {
    console.log("[SESSION] body.sessionId recibido:", bodySessionId ?? "(undefined/null)");

    const sessionId =
      bodySessionId != null && String(bodySessionId).trim() !== ""
        ? String(bodySessionId).trim()
        : randomUUID();

    console.log("[SESSION] sessionId resuelto (nuevo UUID si no venía en body):", sessionId);

    console.log("[SESSION] Buscando sesión:", sessionId);
    const stored = await getSession(sessionId);
    console.log("[SESSION] Sesión encontrada:", stored);

    const session = sessionFromStored(stored);
    if (!Array.isArray(session.items)) session.items = [];
    if (!Array.isArray(session.sizeCandidates)) session.sizeCandidates = [];
    session.product = session.product ?? null;
    session.stage = session.stage ?? "exploration";
    session.promoShown = !!session.promoShown;
    if (!session.customerData || typeof session.customerData !== "object") session.customerData = {};
    session.recommendedSize =
      session.recommendedSize != null && String(session.recommendedSize).trim() !== ""
        ? normalizeSessionSizeToken(session.recommendedSize) || null
        : null;

    console.log("INPUT:", trimmedMessage);
    console.log("SESSION BEFORE:", { ...session, items: [...(session.items || [])] });

    updateSession(session, trimmedMessage);

    console.log("SESSION AFTER:", { ...session, items: [...(session.items || [])] });

    const basePrompt = typeof systemPrompt === "string" ? systemPrompt : "";
    const augmentedSystem = [basePrompt, buildSessionSystemAugmentation(session)].filter(Boolean).join("\n\n");

    let reply = await generateResponse(trimmedMessage, {
      systemPrompt: augmentedSystem,
      faqs: Array.isArray(faqs) ? faqs : [],
    });

    if (typeof reply !== "string") {
      console.error("INVALID LLM REPLY:", reply);
      reply = "";
    }

    const detectedRec = extractRecommendedSizeFromReply(reply);
    if (detectedRec) {
      session.recommendedSize = detectedRec;
    }

    session.promoShown = true;

    const stateSnapshot = sessionStateForPrompt(session);
    console.log("[SESSION] Guardando sesión:", sessionId, stateSnapshot);
    try {
      await saveSession(sessionId, stateSnapshot);
    } catch (error) {
      console.error("[SESSION] Error guardando:", error);
      throw toError(error);
    }

    res.json({ reply, sessionId });
  } catch (err) {
    console.error("CHAT ERROR:", err);
    console.error("STACK:", err?.stack);

    return res.status(500).json({
      error: httpErrorMessage(err),
    });
  }
});

app.use(express.static(distPath));
app.get("/{*path}", (req, res) => {
  res.sendFile(join(distPath, "index.html"));
});

export default app;

const PORT = process.env.PORT || 3000;
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Puerto ${PORT} ocupado. Cambia PORT en .env`);
      process.exit(1);
    }
  });
}

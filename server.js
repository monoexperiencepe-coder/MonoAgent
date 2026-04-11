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

/** Sustituye la cantidad de esa talla (no suma con la anterior). Otras líneas se conservan. */
function replaceQtyForSingleSize(items, size, qty) {
  const sz = normalizeSessionSizeToken(size);
  if (!sz || qty == null || qty < 1) return mergeItems([], items || []);
  const rest = (items || []).filter((i) => normalizeSessionSizeToken(i.size) !== sz);
  return mergeItems([], [...rest, { size: sz, qty }]);
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
  return {
    product: stored.product ?? null,
    items,
    sizeCandidates,
    stage: stored.stage ?? "exploration",
    promoShown: promoRaw === true || promoRaw === 1 || promoRaw === "true",
    customerData,
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
  return `DATOS DEL CLIENTE YA CONFIRMADOS (no volver a pedir de nuevo lo que ya aparece abajo):
${parts.join("\n")}`;
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
    session.items = mergeItems(session.items, incoming);
    session.sizeCandidates = [];
  } else if (session.product) {
    const orphan = extractOrphanQuantity(message);
    if (orphan != null && orphan >= 1) {
      const implied = uniqueImpliedSize(session);
      if (implied) {
        session.items = replaceQtyForSingleSize(session.items, implied, orphan);
        session.sizeCandidates = [];
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
  return {
    product: session.product,
    items: session.items,
    sizeCandidates: Array.isArray(session.sizeCandidates) ? session.sizeCandidates : [],
    stage: session.stage,
    promoShown: !!session.promoShown,
    customerData: { ...cd },
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
  const hasSizeAndQty = hasLineItems(session);
  const promoRules = session.promoShown
    ? `PROMOS (promoShown=true):
* PROHIBIDO mostrar el bloque completo de promos (listados, packs, tablas de precios promocionales, bienvenida comercial repetida)
* Si el cliente no pide explícitamente precios o promos, no listes promos`
    : "";
  const priceRules = hasSizeAndQty
    ? `PRECIOS: El cliente ya tiene talla y cantidad en items[] — puedes indicar precio total y desglose según tus instrucciones.`
    : `PRECIOS: NO muestres precio total ni tablas de promos todavía — aún no hay talla y cantidad en items[]; pregunta solo lo que falte para completar el pedido.`;
  return `

ESTADO ACTUAL DEL CLIENTE (JSON; items[] = una entrada por talla, sin colapsar):
${JSON.stringify(sessionStateForPrompt(session))}

${orderLock ? `${orderLock}\n\n` : ""}Desglose obligatorio (repite tal cual en confirmaciones; formato compacto tipo "2 M y 1 L"):
${lines}

${custBlock ? `${custBlock}\n\n` : ""}${candLine ? `${candLine}\n` : ""}

${promoRules ? `${promoRules}\n\n` : ""}${priceRules}

PRODUCTO ÚNICO:
* Solo vendemos el Oversize High Cotton Ultra Grueso 11/1 en negro
* NUNCA ofrezcas otros productos ni otras líneas
* NO repitas el nombre del producto en cada mensaje — el cliente ya sabe qué está comprando

FLUJO DE CONVERSACIÓN:
* Si promoShown es false en el JSON: primera respuesta puede ser bienvenida breve + promos completas una sola vez + pregunta por talla
* Si promoShown es true en el JSON: NUNCA vuelvas a mostrar promos completas salvo que el cliente pregunte explícitamente por precios o promociones (refuerzo: ver bloque PROMOS arriba si aplica)
* Una vez el cliente indica talla (o está clara en el estado): pregunta SOLO por cantidad
* Una vez tienes talla y cantidad en items[]: di el precio total y avanza al cierre (datos de envío / confirmación)
* NO repitas las promos en cada mensaje
* NO repitas el nombre del producto en cada mensaje
* NO digas "delivery gratis" en cada mensaje — solo al confirmar el pedido final

SECUENCIA IDEAL:
1. Bienvenida + promos + pregunta talla → una sola vez
2. Cliente da talla → pregunta cantidad directamente
3. Cliente da cantidad → di precio total y pregunta datos de envío
4. Cliente da datos → confirma pedido y da instrucciones de pago

Si el cliente hace preguntas intermedias (envíos, colores, etc.) responde de forma puntual y retoma la secuencia donde quedó.

PROHIBIDO: sumar cantidades de tallas distintas y expresarlas como una sola talla (ej. NO "3 M" si en realidad es 2 M + 1 L).

REGLAS IMPORTANTES:

* Usa este estado para mantener contexto
* El estado actual (JSON y desglose arriba) siempre está visible para ti: úsalo para no repetir preguntas ya respondidas
* Si el cliente ya eligió talla (hay líneas en items[] con cantidades por talla), NUNCA volver a preguntar por talla
* Si session.product está definido, no presentes catálogo ni otras líneas (producto único; ver arriba)
* Si hay cantidades en items[], no vuelvas a ofrecer bloques de promos salvo que pregunten explícitamente por precios (ver FLUJO DE CONVERSACIÓN)
* Cuando el cliente haga una pregunta fuera del flujo (envíos, pagos, colores), respóndela brevemente y RETOMA desde donde estaba la conversación con un resumen del pedido actual
* Formato de retoma: "Por cierto, tu pedido sigue apartado: [resumen] ¿Confirmamos?"
* NUNCA reiniciar la conversación si ya hay datos en el estado
* No cambies de producto si ya hay uno definido
* Cada elemento de items[] es independiente: nunca fusiones tallas ni redistribuyas cantidades entre tallas
* Si stage = "intention", enfócate en completar unidades y cerrar
* Si stage = "closing", confirma el pedido con el desglose por talla y pide datos para pago
* Si customerData en el JSON ya tiene campos rellenos, NO vuelvas a pedir esos datos de envío; solo pregunta lo que falte

COMPORTAMIENTO SEGÚN stage:

* exploration: orienta a talla; promos completas solo si promoShown es false (ver FLUJO DE CONVERSACIÓN)
* interest: responde de forma puntual; aún no hay líneas en items
* intention: hay líneas en items; refuerza mínimo de unidades si aplica
* closing: listo para pago; confirma producto, cada talla con su cantidad y precios según información definida

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

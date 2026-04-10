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
    return { product: null, items: [], sizeCandidates: [], stage: "exploration" };
  }
  const raw = Array.isArray(stored.items)
    ? stored.items.map((i) => ({ size: i.size, qty: Number(i.qty) }))
    : [];
  const items = mergeItems([], raw);
  const rawCand = stored.sizeCandidates ?? stored.size_candidates;
  const sizeCandidates = Array.isArray(rawCand) ? [...rawCand] : [];
  return {
    product: stored.product ?? null,
    items,
    sizeCandidates,
    stage: stored.stage ?? "exploration",
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
  } else if (session.product && !hasLineItems(session)) {
    const cand = detectSizeCandidates(m);
    if (cand && cand.length >= 2) {
      session.sizeCandidates = cand;
    }
  }

  session.items = mergeItems([], session.items);

  recomputeStage(session);

  console.log("[SESSION] Estado actualizado:", session);
}

function sessionStateForPrompt(session) {
  return {
    product: session.product,
    items: session.items,
    sizeCandidates: Array.isArray(session.sizeCandidates) ? session.sizeCandidates : [],
    stage: session.stage,
  };
}

function buildSessionSystemAugmentation(session) {
  const lines = formatItemsHuman(session.items);
  const cand = Array.isArray(session.sizeCandidates) ? session.sizeCandidates : [];
  const candLine =
    cand.length >= 2
      ? `El cliente está evaluando entre las tallas: ${cand.join(", ")} — ayúdalo a decidir, NO muestres el catálogo general`
      : "";
  return `

ESTADO ACTUAL DEL CLIENTE (JSON; items[] = una entrada por talla, sin colapsar):
${JSON.stringify(sessionStateForPrompt(session))}

Desglose obligatorio (repite tal cual en confirmaciones; formato compacto tipo "2 M y 1 L"):
${lines}

${candLine ? `${candLine}\n` : ""}

PROHIBIDO: sumar cantidades de tallas distintas y expresarlas como una sola talla (ej. NO "3 M" si en realidad es 2 M + 1 L).

REGLAS IMPORTANTES:

* Usa este estado para mantener contexto
* El estado actual (JSON y desglose arriba) siempre está visible para ti: úsalo para no repetir preguntas ya respondidas
* Si el cliente ya eligió talla (hay líneas en items[] con cantidades por talla), NUNCA volver a preguntar por talla
* Si el cliente ya eligió producto (product definido), NUNCA volver a presentar el catálogo
* Si el cliente ya eligió cantidad (hay cantidades en items[]), NUNCA volver a ofrecer promos
* Cuando el cliente haga una pregunta fuera del flujo (envíos, pagos, colores), respóndela brevemente y RETOMA desde donde estaba la conversación con un resumen del pedido actual
* Formato de retoma: "Por cierto, tu pedido sigue apartado: [resumen] ¿Confirmamos?"
* NUNCA reiniciar la conversación si ya hay datos en el estado
* No cambies de producto si ya hay uno definido
* Cada elemento de items[] es independiente: nunca fusiones tallas ni redistribuyas cantidades entre tallas
* Si stage = "intention", enfócate en completar unidades y cerrar
* Si stage = "closing", confirma el pedido con el desglose por talla y pide datos para pago

COMPORTAMIENTO SEGÚN stage:

* exploration: puedes mostrar promos completas
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

    console.log("INPUT:", trimmedMessage);
    console.log("SESSION BEFORE:", { ...session, items: [...(session.items || [])] });

    updateSession(session, trimmedMessage);

    console.log("SESSION AFTER:", { ...session, items: [...(session.items || [])] });

    const stateSnapshot = sessionStateForPrompt(session);
    console.log("[SESSION] Guardando sesión:", sessionId, stateSnapshot);
    try {
      await saveSession(sessionId, stateSnapshot);
    } catch (error) {
      console.error("[SESSION] Error guardando:", error);
      throw toError(error);
    }

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

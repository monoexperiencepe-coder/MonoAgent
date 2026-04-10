import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { generateResponse } from "./src/services/aiService.js";
import { getSession, saveSession } from "./src/lib/sessions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function sessionFromStored(stored) {
  const size =
    stored?.size && typeof stored.size === "object" && !Array.isArray(stored.size)
      ? { ...stored.size }
      : null;
  return {
    product: stored?.product ?? null,
    size: size && Object.keys(size).length ? size : null,
    quantity: stored?.quantity ?? null,
    stage: stored?.stage ?? "exploration",
  };
}

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
  const w = WORD_NUM[tok.toLowerCase()];
  return w ?? null;
}

function normSizeToken(tok) {
  const t = tok.toLowerCase();
  if (t === "xl") return "XL";
  if (t === "s" || t === "m" || t === "l") return t.toUpperCase();
  return null;
}

/** Devuelve { S: n, M: n, ... } o null si no hay coincidencias en este mensaje. */
function sizeFromMessage(m) {
  const lower = String(m).trim().toLowerCase();
  const out = {};
  const qty = String.raw`(\d+|uno|dos|tres|cuatro|cinco|seis)`;
  const sz = String.raw`(xl|s|m|l)`;

  const reEnTalla = new RegExp(`${qty}\\s+en\\s+talla\\s+${sz}\\b`, "gi");
  let ma;
  while ((ma = reEnTalla.exec(lower)) !== null) {
    const n = parseQtyToken(ma[1]);
    const k = normSizeToken(ma[2]);
    if (n != null && k) out[k] = (out[k] || 0) + n;
  }

  const reShort = new RegExp(`(^|\\s)${qty}\\s+${sz}(?=\\s|$|[,.]|\\s+y\\b)`, "gi");
  while ((ma = reShort.exec(lower)) !== null) {
    const n = parseQtyToken(ma[2]);
    const k = normSizeToken(ma[3]);
    if (n != null && k) out[k] = (out[k] || 0) + n;
  }

  if (Object.keys(out).length > 0) {
    return out;
  }

  const phrase = lower.match(/\btallas?\s*[:\s]*\b(xl|s|m|l)\b/);
  if (phrase) {
    const k = normSizeToken(phrase[1]);
    if (k) return { [k]: 1 };
  }

  if (lower === "s" || lower === "m" || lower === "l" || lower === "xl") {
    const k = normSizeToken(lower);
    if (k) return { [k]: 1 };
  }

  return null;
}

function hasPositiveSizeBreakdown(size) {
  return (
    size &&
    typeof size === "object" &&
    Object.values(size).some((n) => Number(n) > 0)
  );
}

function formatSizeBreakdownLine(size) {
  if (!hasPositiveSizeBreakdown(size)) {
    return "no especificado";
  }
  const order = ["S", "M", "L", "XL"];
  const entries = Object.entries(size)
    .filter(([, n]) => Number(n) > 0)
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  return entries
    .map(([sz, n]) => {
      const u = Number(n) === 1 ? "unidad" : "unidades";
      return `${n} ${u} talla ${sz}`;
    })
    .join(", ");
}

function updateSession(session, message) {
  const m = String(message).trim().toLowerCase();

  if (!session.product && m.includes("high cotton")) {
    session.product = "high_cotton";
  }

  const delta = sizeFromMessage(m);
  if (delta && Object.keys(delta).length) {
    session.size = { ...(session.size && typeof session.size === "object" ? session.size : {}), ...delta };
  }
  if (session.size && typeof session.size === "object" && !Object.keys(session.size).length) {
    session.size = null;
  }

  if (/\bdame\s+2\b/.test(m) || /\bquiero\s+2\b/.test(m) || m === "2") {
    session.quantity = 2;
  } else if (/\bdame\s+3\b/.test(m) || /\bquiero\s+3\b/.test(m) || m === "3") {
    session.quantity = 3;
  }

  const hasSizes = hasPositiveSizeBreakdown(session.size);

  if (session.product && hasSizes) {
    session.stage = "closing";
  } else if (session.product && session.quantity != null) {
    session.stage = "intention";
  } else if (session.product) {
    session.stage = "interest";
  } else {
    session.stage = "exploration";
  }

  console.log("[SESSION] Estado actualizado:", session);
}

function sessionStateForPrompt(session) {
  return {
    product: session.product,
    size: session.size,
    quantity: session.quantity,
    stage: session.stage,
  };
}

function buildSessionSystemAugmentation(session) {
  return `

ESTADO ACTUAL DEL CLIENTE:
${JSON.stringify(sessionStateForPrompt(session))}

El cliente eligió: ${formatSizeBreakdownLine(session.size)}

REGLAS IMPORTANTES:

* Usa este estado para mantener contexto
* No reinicies la conversación
* No cambies de producto si ya hay uno definido
* Si stage = "intention", enfócate en cerrar
* Si stage = "closing", confirma el pedido directamente

COMPORTAMIENTO SEGÚN stage:

* exploration: puedes mostrar promos completas
* interest: responde de forma puntual, no repitas todo el catálogo ni promos enteras sin necesidad
* intention: confirma producto y talla; sugiere mínimo 2 unidades; impulsa el cierre
* closing: confirma el pedido indicando producto, talla, cantidad y precio correcto según la información definida; pide los datos del cliente para completar

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

    updateSession(session, trimmedMessage);

    const messages = sessionStateForPrompt(session);
    console.log("[SESSION] Guardando sesión:", sessionId, messages);
    try {
      await saveSession(sessionId, messages);
    } catch (error) {
      console.error("[SESSION] Error guardando:", error);
      throw error;
    }

    const basePrompt = typeof systemPrompt === "string" ? systemPrompt : "";
    const augmentedSystem = [basePrompt, buildSessionSystemAugmentation(session)].filter(Boolean).join("\n\n");

    const reply = await generateResponse(trimmedMessage, {
      systemPrompt: augmentedSystem,
      faqs: Array.isArray(faqs) ? faqs : [],
    });

    res.json({ reply, sessionId });
  } catch (err) {
    console.error("[POST /chat] Error:", err?.message ?? err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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

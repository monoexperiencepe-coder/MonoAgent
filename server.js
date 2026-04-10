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
  return {
    product: stored?.product ?? null,
    size: stored?.size ?? null,
    quantity: stored?.quantity ?? null,
    stage: stored?.stage ?? "exploration",
  };
}

function sizeFromMessage(m) {
  const map = { s: "S", m: "M", l: "L", xl: "XL" };
  const phrase = m.match(/\btallas?\s*[:\s]*\b(s|m|l|xl)\b/);
  if (phrase) return map[phrase[1]];
  if (m in map) return map[m];
  if (/\bxl\b/.test(m)) return "XL";
  if (/\bl\b/.test(m)) return "L";
  if (/\bm\b/.test(m)) return "M";
  if (/\bs\b/.test(m)) return "S";
  return null;
}

function updateSession(session, message) {
  const m = String(message).trim().toLowerCase();

  if (!session.product && m.includes("high cotton")) {
    session.product = "high_cotton";
  }

  const detectedSize = sizeFromMessage(m);
  if (detectedSize) {
    session.size = detectedSize;
  }

  if (/\bdame\s+2\b/.test(m) || /\bquiero\s+2\b/.test(m) || m === "2") {
    session.quantity = 2;
  } else if (/\bdame\s+3\b/.test(m) || /\bquiero\s+3\b/.test(m) || m === "3") {
    session.quantity = 3;
  }

  if (session.product && session.size && session.quantity != null) {
    session.stage = "closing";
  } else if (session.product && session.size) {
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

El cliente ya eligió talla: ${session.size ?? "no especificada"}

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

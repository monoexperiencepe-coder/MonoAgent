import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { generateResponse } from "./src/services/aiService.js";
import { getSession, saveSession } from "./src/lib/sessions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function defaultSessionState() {
  return {
    product: null,
    size: null,
    quantity: null,
    stage: "exploration",
  };
}

function sessionFromStored(stored) {
  const base = defaultSessionState();
  if (!stored || typeof stored !== "object") return base;
  return {
    product: stored.product ?? base.product,
    size: stored.size ?? base.size,
    quantity: stored.quantity ?? base.quantity,
    stage: stored.stage ?? base.stage,
  };
}

function updateSession(session, message) {
  const m = String(message).trim().toLowerCase();

  if (!session.product && m.includes("high cotton")) {
    session.product = "high_cotton";
  }

  const sizeByToken = { s: "S", m: "M", l: "L", xl: "XL" };
  if (m in sizeByToken) {
    session.size = sizeByToken[m];
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
    const sessionId =
      bodySessionId != null && String(bodySessionId).trim() !== ""
        ? String(bodySessionId).trim()
        : randomUUID();

    const stored = await getSession(sessionId);
    const session = sessionFromStored(stored);

    updateSession(session, trimmedMessage);
    await saveSession(sessionId, sessionStateForPrompt(session));

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

app.use(express.static(join(__dirname, "client/dist")));
app.get("/{*path}", (req, res) => {
  res.sendFile(join(__dirname, "client/dist/index.html"));
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

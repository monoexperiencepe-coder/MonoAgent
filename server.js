import "dotenv/config";
import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { generateResponse } from "./src/services/aiService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  const { message, systemPrompt, faqs } = req.body ?? {};

  if (message === undefined || message === null || String(message).trim() === "") {
    return res.status(400).json({ error: "message es requerido" });
  }

  if (faqs !== undefined && !Array.isArray(faqs)) {
    return res.status(400).json({ error: "faqs debe ser un array" });
  }

  try {
    const reply = await generateResponse(String(message).trim(), {
      systemPrompt: typeof systemPrompt === "string" ? systemPrompt : "",
      faqs: Array.isArray(faqs) ? faqs : [],
    });
    res.json({ reply });
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

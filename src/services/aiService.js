import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(systemPrompt, faqs) {
  const parts = [];

  if (typeof systemPrompt === "string" && systemPrompt.trim()) {
    parts.push(systemPrompt.trim());
  }

  if (Array.isArray(faqs) && faqs.length > 0) {
    const lines = faqs
      .filter((f) => f && String(f.question ?? "").trim() && String(f.answer ?? "").trim())
      .map((f) => `P: ${String(f.question).trim()}\nR: ${String(f.answer).trim()}`)
      .join("\n\n");

    if (lines) {
      parts.push(
        "Usa las siguientes preguntas frecuentes solo como referencia; responde de forma natural y coherente con el mensaje del usuario:\n\n" +
          lines
      );
    }
  }

  return parts.length ? parts.join("\n\n") : undefined;
}

function sanitizeAnthropicHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const row of history) {
    if (!row || typeof row !== "object") continue;
    const role = row.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = String(row.content ?? "").trim();
    if (!text) continue;
    out.push({ role, content: text.slice(0, 50000) });
  }
  return out;
}

export async function generateResponse(message, { systemPrompt = "", faqs = [], history = [] } = {}) {
  const system = buildSystemPrompt(systemPrompt, faqs);
  const models = ["claude-opus-4-6", "claude-haiku-4-5-20251001"];
  let trimmedHistory = sanitizeAnthropicHistory(history).slice(-20);
  while (trimmedHistory.length > 0 && trimmedHistory[0].role === "assistant") {
    trimmedHistory = trimmedHistory.slice(1);
  }
  const userContent = String(message ?? "").trim();
  const messages = [...trimmedHistory, { role: "user", content: userContent || " " }];

  for (const model of models) {
    try {
      console.log(`[AI] Intentando con modelo: ${model}`);
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages,
      });
      console.log(`[AI] Éxito con: ${model}`);
      const block = response.content?.find((b) => b.type === "text");
      return block?.text ?? "";
    } catch (err) {
      console.error(`[AI] Falló ${model}:`, err.message);
    }
  }
  throw new Error("Todos los modelos fallaron");
}

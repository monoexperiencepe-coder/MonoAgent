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

export async function generateResponse(message, { systemPrompt = "", faqs = [] } = {}) {
  const system = buildSystemPrompt(systemPrompt, faqs);
  const models = ["claude-opus-4-6", "claude-haiku-4-5-20251001"];

  for (const model of models) {
    try {
      console.log(`[AI] Intentando con modelo: ${model}`);
      const response = await client.messages.create({
        model,
        max_tokens: 1024,
        ...(system ? { system } : {}),
        messages: [{ role: "user", content: message }],
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

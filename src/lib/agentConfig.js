import { getSupabase } from "./supabase.js";
import { toError } from "./errors.js";

/**
 * Tabla global de instrucciones para el agente (sincroniza /chat con /whatsapp).
 *
 * CREATE TABLE agent_config (
 *   id text PRIMARY KEY DEFAULT 'default',
 *   system_prompt text DEFAULT '',
 *   faqs jsonb DEFAULT '[]',
 *   updated_at timestamptz DEFAULT now()
 * );
 *
 * INSERT INTO agent_config (id) VALUES ('default')
 *   ON CONFLICT (id) DO NOTHING;
 */

const DEFAULT_ID = "default";

function rowToConfig(data) {
  if (!data) return { systemPrompt: "", faqs: [] };
  return {
    systemPrompt: typeof data.system_prompt === "string" ? data.system_prompt : "",
    faqs: Array.isArray(data.faqs) ? data.faqs : [],
  };
}

async function selectAgentConfigRow() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("agent_config")
    .select("system_prompt, faqs")
    .eq("id", DEFAULT_ID)
    .maybeSingle();
  if (error) throw toError(error);
  return data;
}

export async function getAgentConfig() {
  try {
    const data = await selectAgentConfigRow();
    return rowToConfig(data);
  } catch (e) {
    console.warn("[agent_config] lectura fallida:", e?.message ?? e);
    return { systemPrompt: "", faqs: [] };
  }
}

/**
 * @param {{ systemPrompt?: string, faqs?: unknown[] }} patch
 * Solo actualiza las claves presentes; el resto se conserva desde BD.
 */
export async function saveAgentConfig(patch) {
  if (patch.systemPrompt === undefined && patch.faqs === undefined) return;

  const data = await selectAgentConfigRow();
  const current = rowToConfig(data);
  const system_prompt =
    patch.systemPrompt !== undefined ? String(patch.systemPrompt) : current.systemPrompt;
  const faqs = patch.faqs !== undefined ? (Array.isArray(patch.faqs) ? patch.faqs : []) : current.faqs;

  const supabase = getSupabase();
  const { error } = await supabase.from("agent_config").upsert(
    {
      id: DEFAULT_ID,
      system_prompt,
      faqs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (error) throw toError(error);
}

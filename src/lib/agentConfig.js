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

function coerceJson(v, fallback) {
  if (v == null) return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

function rowToConfig(data) {
  if (!data) return { systemPrompt: "", faqs: [], whatsappToken: "", promos: "", business: {} };
  const extra = coerceJson(data.extra, {});
  return {
    systemPrompt:  typeof data.system_prompt === "string" ? data.system_prompt : "",
    faqs:          Array.isArray(data.faqs) ? data.faqs : [],
    whatsappToken: typeof extra.whatsappToken === "string" ? extra.whatsappToken : "",
    promos:        typeof extra.promos === "string" ? extra.promos : "",
    business:      extra.business && typeof extra.business === "object" ? extra.business : {},
  };
}

async function selectAgentConfigRow() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("agent_config")
    .select("system_prompt, faqs, extra")
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
    return { systemPrompt: "", faqs: [], whatsappToken: "", promos: "", business: {} };
  }
}

/**
 * @param {{ systemPrompt?: string, faqs?: unknown[], whatsappToken?: string, promos?: string, business?: object }} patch
 * Solo actualiza las claves presentes; el resto se conserva desde BD.
 * Requiere columna `extra` jsonb en agent_config:
 *   ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS extra jsonb DEFAULT '{}'::jsonb;
 */
export async function saveAgentConfig(patch) {
  const hasCore  = patch.systemPrompt !== undefined || patch.faqs !== undefined;
  const hasExtra = patch.whatsappToken !== undefined || patch.promos !== undefined || patch.business !== undefined;
  if (!hasCore && !hasExtra) return;

  const data = await selectAgentConfigRow();
  const current = rowToConfig(data);

  const system_prompt = patch.systemPrompt !== undefined ? String(patch.systemPrompt) : current.systemPrompt;
  const faqs          = patch.faqs !== undefined ? (Array.isArray(patch.faqs) ? patch.faqs : []) : current.faqs;

  const currentExtra = coerceJson(data?.extra, {});
  const extra = {
    ...currentExtra,
    ...(patch.whatsappToken !== undefined ? { whatsappToken: String(patch.whatsappToken) } : {}),
    ...(patch.promos        !== undefined ? { promos: String(patch.promos) }               : {}),
    ...(patch.business      !== undefined ? { business: patch.business }                   : {}),
  };

  const supabase = getSupabase();
  const { error } = await supabase.from("agent_config").upsert(
    { id: DEFAULT_ID, system_prompt, faqs, extra, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );
  if (error) throw toError(error);
}

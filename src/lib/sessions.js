import { getSupabase } from './supabase.js';

export async function saveSession(sessionId, messages) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('sessions')
    .upsert({ id: sessionId, messages, updated_at: new Date() });
  if (error) throw error;
}

export async function getSession(sessionId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('sessions')
    .select('messages')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data?.messages ?? null;
}

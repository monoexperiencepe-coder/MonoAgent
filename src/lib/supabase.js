import { createClient } from '@supabase/supabase-js';

let supabaseInstance = null;

export function getSupabase() {
  if (supabaseInstance) return supabaseInstance;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(`Supabase ENV missing: url=${url} key=${key ? 'OK' : 'MISSING'}`);
  }

  supabaseInstance = createClient(url, key);
  return supabaseInstance;
}

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const backendReady = Boolean(url && key);
export const supabase = backendReady
  ? createClient(url, key, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        storageKey: "zfc-auth-session",
      },
    })
  : null;
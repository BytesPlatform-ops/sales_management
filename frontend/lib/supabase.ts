import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// createClient throws on an empty URL, which crashes every page that imports
// this module (including at build/prerender time). Fall back to a placeholder
// so pages still render; realtime updates simply won't connect until the
// NEXT_PUBLIC_SUPABASE_* vars are set.
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY not set; Supabase realtime is disabled.');
}

export const supabase = createClient(
  supabaseUrl || 'http://localhost:54321',
  supabaseAnonKey || 'public-anon-key-not-set'
);

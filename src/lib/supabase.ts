import { createClient } from '@supabase/supabase-js';
import { env, configured } from '../config';

/**
 * Hard read-only guard. Every call to the PostgREST data API (/rest/v1/) must be GET or HEAD.
 * Any write attempt (POST/PATCH/PUT/DELETE) is rejected in the browser before it leaves the app.
 * Auth endpoints (/auth/v1/) are not data API calls and are only used for sign-in / sign-out.
 */
const guardedFetch: typeof fetch = (input: any, init?: any) => {
  const url: string = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = String(init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase();
  if (url.includes('/rest/v1/') && method !== 'GET' && method !== 'HEAD') {
    return Promise.reject(new Error(`Blocked: this dashboard is read-only (${method} request refused).`));
  }
  return fetch(input, init);
};

export const supabase = createClient(
  configured ? env.url : 'https://placeholder.invalid',
  configured ? env.anon : 'placeholder-anon-key-placeholder',
  {
    global: { fetch: guardedFetch },
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  },
);

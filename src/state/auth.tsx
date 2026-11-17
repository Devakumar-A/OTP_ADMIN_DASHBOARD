import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { env } from '../config';

interface AuthCtx {
  session: Session | null;
  loading: boolean;
  denied: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Access gate. This is a convenience layer only: the real boundary is Supabase RLS.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDenied(null);
      if (!session) return;
      const email = (session.user.email ?? '').toLowerCase();
      if (env.adminEmails.length && !env.adminEmails.includes(email)) {
        if (!cancelled) setDenied('This account is not on the administrator list for this dashboard.');
        return;
      }
      // Receptionist accounts must use the receptionist app, not the admin dashboard.
      const { data } = await supabase.from('receptionists').select('id').eq('auth_user_id', session.user.id).limit(1);
      if (!cancelled && data && data.length > 0 && !env.adminEmails.includes(email)) {
        setDenied('Receptionist accounts cannot open the admin dashboard. Please use an administrator account.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? error.message : null;
  };
  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return <Ctx.Provider value={{ session, loading, denied, signIn, signOut }}>{children}</Ctx.Provider>;
}

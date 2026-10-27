'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  username: string;
  full_name: string;
  /** Permission role used by screens. A CEO is 'hr' here (they see every HR screen); see isCeo. */
  role: 'hr' | 'agent' | 'developer';
  /** The real role from the server ('ceo' for executives). */
  realRole?: 'hr' | 'agent' | 'developer' | 'ceo';
  isCeo?: boolean;
  /** A CEO's read-only "view as" session of this user. */
  view_as?: { by_id: number; by_name: string } | null;
  readonly?: boolean;
  /** CEO Admin mode: epoch seconds when it ends. */
  admin_until?: number | null;
  extension_number: string;
  base_salary: number;
  employment_type: 'full_time' | 'part_time';
}

interface AttendanceInfo {
  isNewRecord: boolean;
  date: string;
  status: 'on_time' | 'late' | 'half_day';
  minutesLate?: number;
  message: string;
  checkInTime?: string;
}

interface LoginResult {
  user: User;
  attendance: AttendanceInfo | null;
}

/** A CEO password login returns this instead of a token. */
export interface TotpChallenge { totp_required: true; challenge: string; enrolled: boolean }

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<LoginResult | TotpChallenge | null>;
  logout: () => void;
  /** Swap in a new token (TOTP login, Admin mode, view-as) and reload the user. */
  applyToken: (token: string | null) => Promise<User | null>;
  refresh: () => Promise<User | null>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const token = api.getToken();
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await api.getMe();
      if (response.data) {
        setUser(normalizeUser(response.data));
      }
    } catch (error) {
      api.setToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function refresh(): Promise<User | null> {
    try {
      const response = await api.getMe();
      const u = response.data ? normalizeUser(response.data) : null;
      setUser(u);
      return u;
    } catch {
      api.setToken(null);
      setUser(null);
      return null;
    }
  }

  async function applyToken(token: string | null) {
    api.setToken(token);
    return token ? refresh() : (setUser(null), null);
  }

  async function login(username: string, password: string, remember = false): Promise<LoginResult | TotpChallenge | null> {
    const response = await api.login(username, password, remember);
    const data: any = response.data;
    if (data?.totp_required) return data as TotpChallenge;

    if (response.data?.user) {
      setUser(normalizeUser(response.data.user));
      
      // Note: Redirect is handled by the login page's animated transition
      // Do not redirect here to avoid race conditions

      return {
        user: response.data.user,
        attendance: response.data.attendance,
      };
    }

    return null;
  }

  function logout() {
    // End the session server-side too (HR/CEO tokens stop working at once).
    const t = api.getToken();
    if (t) fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } }).catch(() => {});
    try { localStorage.removeItem('ceo_token'); } catch {}
    api.logout();
    setUser(null);
    router.push('/login');
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        applyToken,
        refresh,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Server user → screen user: a CEO gets HR screens plus CEO extras. */
function normalizeUser(u: any): User {
  const realRole = u.role;
  return { ...u, realRole, isCeo: realRole === 'ceo' && !u.view_as, role: realRole === 'ceo' ? 'hr' : realRole };
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

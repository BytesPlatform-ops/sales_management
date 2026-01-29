'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { api } from '@/lib/api-client';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  username: string;
  full_name: string;
  role: 'hr' | 'agent';
  extension_number: string;
  base_salary: number;
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

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult | null>;
  logout: () => void;
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
        setUser(response.data);
      }
    } catch (error) {
      api.setToken(null);
    } finally {
      setLoading(false);
    }
  }

  async function login(username: string, password: string): Promise<LoginResult | null> {
    const response = await api.login(username, password);
    
    if (response.data?.user) {
      setUser(response.data.user);
      
      // Redirect based on role
      if (response.data.user.role === 'hr') {
        router.push('/hr');
      } else {
        router.push('/agent');
      }

      return {
        user: response.data.user,
        attendance: response.data.attendance,
      };
    }

    return null;
  }

  function logout() {
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
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

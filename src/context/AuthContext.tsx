import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi, tokenStorage } from '../api/client';
import type { User, UserRole } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadCurrentUser = useCallback(async () => {
    const token = tokenStorage.getAccess();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const resp = await authApi.me();
      setUser(resp.data);
    } catch {
      tokenStorage.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCurrentUser();
    const onExpired = () => {
      setUser(null);
    };
    window.addEventListener('auth:session-expired', onExpired);
    return () => window.removeEventListener('auth:session-expired', onExpired);
  }, [loadCurrentUser]);

  const login = async (email: string, password: string): Promise<User> => {
    const resp = await authApi.login(email, password);
    tokenStorage.setTokens(resp.data.access_token, resp.data.refresh_token);
    setUser(resp.data.user);
    return resp.data.user;
  };

  const logout = async () => {
    const refresh = tokenStorage.getRefresh();
    try {
      await authApi.logout(refresh);
    } catch {
      // Ignore network errors during logout
    } finally {
      tokenStorage.clear();
      setUser(null);
    }
  };

  const hasRole = (...roles: UserRole[]) => {
    if (!user) return false;
    return roles.includes(user.role);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser: loadCurrentUser, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

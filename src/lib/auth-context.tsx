import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { generateProxyEmail } from "./mock-data";

interface UserProfile {
  firstName: string;
  lastName: string;
  city: string;
  identifierType: "state" | "dob";
  state?: string;
  dob?: string;
  proxyEmail: string;
  onboarded: boolean;
  runId?: string;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: UserProfile | null;
  login: () => void;
  logout: () => void;
  completeOnboarding: (data: Omit<UserProfile, "proxyEmail" | "onboarded">, options?: { proxyEmail?: string }) => void;
  attachRun: (runId: string, proxyEmail?: string) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);
const AUTH_STORAGE_KEY = "data-shield-auth";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);

  useEffect(() => {
    const stored = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored) as { isAuthenticated: boolean; user: UserProfile | null };
      setIsAuthenticated(parsed.isAuthenticated);
      setUser(parsed.user);
    } catch {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        isAuthenticated,
        user,
      }),
    );
  }, [isAuthenticated, user]);

  const login = useCallback(() => {
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  const completeOnboarding = useCallback(
    (data: Omit<UserProfile, "proxyEmail" | "onboarded">, options?: { proxyEmail?: string }) => {
      setUser({
        ...data,
        proxyEmail: options?.proxyEmail ?? generateProxyEmail(),
        onboarded: true,
      });
    },
    []
  );

  const attachRun = useCallback((runId: string, proxyEmail?: string) => {
    setUser((current) => {
      if (!current) return current;
      return {
        ...current,
        runId,
        proxyEmail: proxyEmail ?? current.proxyEmail,
      };
    });
  }, []);

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, completeOnboarding, attachRun }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

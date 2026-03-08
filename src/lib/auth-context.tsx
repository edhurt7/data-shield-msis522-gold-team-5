import React, { createContext, useContext, useState, useCallback } from "react";
import { generateProxyEmail } from "./mock-data";

interface UserProfile {
  firstName: string;
  lastName: string;
  identifierType: "state" | "dob";
  state?: string;
  dob?: string;
  proxyEmail: string;
  onboarded: boolean;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: UserProfile | null;
  login: () => void;
  logout: () => void;
  completeOnboarding: (data: Omit<UserProfile, "proxyEmail" | "onboarded">) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);

  const login = useCallback(() => {
    setIsAuthenticated(true);
    // Simulate: check if user has completed onboarding
    // For demo, new login = no onboarding yet
  }, []);

  const logout = useCallback(() => {
    setIsAuthenticated(false);
    setUser(null);
  }, []);

  const completeOnboarding = useCallback(
    (data: Omit<UserProfile, "proxyEmail" | "onboarded">) => {
      setUser({
        ...data,
        proxyEmail: generateProxyEmail(),
        onboarded: true,
      });
    },
    []
  );

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, completeOnboarding }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { auth } from "@/lib/firebase-client";
import { apiClient } from "@/lib/apiClient";
import { UserProfile } from "@/types";

interface AuthContextType {
  firebaseUser: User | null;
  user: UserProfile | null;
  loading: boolean;
  error: string | null;
  signInWithGoogle: () => Promise<UserProfile>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async (currentUser: User) => {
    try {
      // Fetch profile for already registered user
      const res = await apiClient.get<{ user: UserProfile }>("/api/auth/me");
      setUser(res.user);
    } catch {
      // If profile doesn't exist yet, try to complete registration
      try {
        const res = await apiClient.post<{ user: UserProfile }>(
          "/api/auth/complete-registration"
        );
        setUser(res.user);
      } catch (err: any) {
        // Not on whitelist - sign out
        await firebaseSignOut(auth);
        setUser(null);
        setFirebaseUser(null);
        setError(err?.message || "Account not authorized");
      }
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      setFirebaseUser(authUser);
      if (authUser) {
        await fetchProfile(authUser);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (): Promise<UserProfile> => {
    setError(null);
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);

      try {
        const res = await apiClient.post<{ user: UserProfile }>(
          "/api/auth/complete-registration"
        );
        setUser(res.user);
        setFirebaseUser(credential.user);
        return res.user;
      } catch (serverErr: any) {
        await firebaseSignOut(auth);
        setUser(null);
        setFirebaseUser(null);
        const errorMsg =
          serverErr?.message ||
          "Your Google account is not on the placement whitelist.";
        setError(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (err: any) {
      const msg = err?.message || "Failed to sign in with Google";
      setError(msg);
      throw new Error(msg);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setFirebaseUser(null);
  };

  const refreshUser = async () => {
    if (auth.currentUser) {
      await fetchProfile(auth.currentUser);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        user,
        loading,
        error,
        signInWithGoogle,
        signOut,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

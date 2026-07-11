import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, setUnauthorizedHandler, UnauthorizedError } from "@/lib/api";
import type { AuthStatus, User } from "@/types";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("unknown");

  const bootstrap = useCallback(async () => {
    try {
      const { user } = await api.auth.whoami();
      setUser(user);
      setStatus("authenticated");
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        setUser(null);
        setStatus("anonymous");
      } else {
        // network / server error — still show login so the user isn't stuck
        setUser(null);
        setStatus("anonymous");
      }
    }
  }, []);

  useEffect(() => {
    void bootstrap();
    // Wire the shared 401 handler so any request landing on 401 bounces us out.
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus("anonymous");
    });
  }, [bootstrap]);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const { user } = await api.auth.login(username, password);
      setUser(user);
      setStatus("authenticated");
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Login failed" };
    }
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    try {
      const { user } = await api.auth.register(username, email, password);
      setUser(user);
      setStatus("authenticated");
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : "Sign up failed" };
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      /* server error is fine; still clear local state */
    }
    setUser(null);
    setStatus("anonymous");
    toast.success("Signed out");
  }, []);

  return { user, status, login, register, logout, refresh: bootstrap };
}

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { User, UserInput } from "@/types";

export function useUsers(enabled: boolean) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const { users } = await api.users.list();
      setUsers(users);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(async (payload: UserInput) => {
    try {
      await api.users.add(payload);
      toast.success("User created");
      await refresh();
      return true;
    } catch (e) {
      toast.error("Add failed", { description: (e as Error).message });
      return false;
    }
  }, [refresh]);

  const patch = useCallback(async (id: string, payload: UserInput) => {
    try {
      await api.users.patch(id, payload);
      toast.success("User updated");
      await refresh();
      return true;
    } catch (e) {
      toast.error("Update failed", { description: (e as Error).message });
      return false;
    }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    try {
      await api.users.remove(id);
      toast.success("User removed");
      await refresh();
      return true;
    } catch (e) {
      toast.error("Remove failed", { description: (e as Error).message });
      return false;
    }
  }, [refresh]);

  return { users, loading, error, refresh, add, patch, remove };
}

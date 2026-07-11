import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import type { AppSettings } from "@/types";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSettings(await api.settings.get());
    } catch {
      /* ignore — likely 401 during logout */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setModel = useCallback(async (deployment: string) => {
    try {
      const next = await api.settings.setModel(deployment);
      setSettings(next);
      toast.success(`Model: ${deployment}`);
      return true;
    } catch (e) {
      toast.error("Could not switch model", { description: (e as Error).message });
      return false;
    }
  }, []);

  return {
    settings,
    loading,
    setModel,
    refresh,
  };
}

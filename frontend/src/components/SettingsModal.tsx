import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Cpu,
  Info,
  Monitor,
  Moon,
  Palette,
  Server,
  ShieldCheck,
  Sun,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { api } from "@/lib/api";
import { UsersAccessSection } from "@/components/UsersAccessSection";
import type { AppSettings, LlmProvider, User, UserRole } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AppSettings | null;
  user: User | null;
  onSetProvider: (provider: LlmProvider) => Promise<boolean>;
  onSetModel: (deployment: string) => Promise<boolean>;
}

type Section = "provider" | "model" | "appearance" | "role" | "access";

const ROLE_LABEL: Record<UserRole, string> = {
  user: "User",
  admin: "Admin",
  super_admin: "Super admin",
};

const PROVIDER_LABEL: Record<LlmProvider, string> = {
  azure: "Azure OpenAI",
  groq: "Groq",
};

const THEMES: { id: Theme; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

export function SettingsModal({ open, onOpenChange, settings, user, onSetProvider, onSetModel }: Props) {
  const { theme, setTheme } = useTheme();
  const [section, setSection] = useState<Section | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [savingModel, setSavingModel] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);

  const provider = settings?.llm.provider ?? "azure";

  // Always start on the list when the modal (re)opens.
  useEffect(() => {
    if (open) setSection(null);
  }, [open]);

  // Reset the cached model list whenever the active provider changes, so the
  // picker reloads the new provider's models on next open.
  useEffect(() => {
    setModels(null);
    setModelsError(null);
  }, [provider]);

  // Lazily load models the first time the model section is opened (per provider).
  useEffect(() => {
    if (section !== "model" || models !== null || modelsError !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.settings.models();
        if (!cancelled) setModels(res.deployments);
      } catch (e) {
        if (!cancelled) setModelsError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section, models, modelsError]);

  const providerAvailable = (p: LlmProvider) =>
    p === "azure" ? true : !!settings?.llm.groq_available;

  const handleProviderChange = async (next: LlmProvider) => {
    if (next === provider) return;
    setSavingProvider(true);
    await onSetProvider(next);
    setSavingProvider(false);
  };

  const handleModelChange = async (deployment: string) => {
    setSavingModel(true);
    await onSetModel(deployment);
    setSavingModel(false);
  };

  const modelValue = settings?.llm.configured ? settings.llm.deployment : "Not configured";
  const themeValue = theme.charAt(0).toUpperCase() + theme.slice(1);
  const role = settings?.role ?? user?.role ?? "user";
  const canManageConfig = settings?.can_manage_config ?? false;
  const canManageUsers = settings?.can_manage_users ?? false;

  const rows: {
    id: Section;
    label: string;
    value: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "role", label: "Role", value: ROLE_LABEL[role], icon: ShieldCheck },
    { id: "provider", label: "LLM provider", value: PROVIDER_LABEL[provider], icon: Server },
    { id: "model", label: "Assistant model", value: modelValue, icon: Cpu },
    ...(canManageUsers
      ? [{ id: "access" as Section, label: "Users & access", value: "", icon: Users }]
      : []),
    { id: "appearance", label: "Appearance", value: themeValue, icon: Palette },
  ];

  const title = section
    ? rows.find((r) => r.id === section)!.label
    : "Settings";

  const wide = section === "access";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(wide ? "max-w-2xl" : "max-w-md")}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            {section && (
              <button
                type="button"
                onClick={() => setSection(null)}
                className="-ml-1 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label="Back to settings"
              >
                <ChevronLeft className="size-4" />
              </button>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          {!section && (
            <DialogDescription>Manage your assistant model and appearance.</DialogDescription>
          )}
        </DialogHeader>

        {/* LIST VIEW */}
        {!section && (
          <div className="grid gap-1.5">
            {rows.map(({ id, label, value, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className="flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition hover:border-primary/40 hover:bg-accent"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                </span>
                <span className="max-w-[45%] truncate text-[13px] text-muted-foreground">
                  {value}
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}

        {/* DETAIL: Role (read-only, everyone) */}
        {section === "role" && (
          <div className="grid gap-3">
            <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="size-5" />
              </span>
              <div>
                <div className="text-sm font-semibold">{ROLE_LABEL[role]}</div>
                <div className="text-[12px] text-muted-foreground">
                  {role === "super_admin"
                    ? "Full access to every tool, plus user and configuration management."
                    : role === "admin"
                      ? "Can manage MCP servers and settings; uses the tools assigned to you."
                      : "Can chat with the tools assigned to you."}
                </div>
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              Your role and tool access are managed by a super admin.
            </p>
          </div>
        )}

        {/* DETAIL: LLM provider */}
        {section === "provider" && (
          <div className="grid gap-3">
            <div className="grid gap-2">
              {(settings?.llm.providers ?? ["azure", "groq"]).map((p) => {
                const active = provider === p;
                const available = providerAvailable(p);
                const disabled = !canManageConfig || savingProvider || !available;
                return (
                  <button
                    key={p}
                    type="button"
                    disabled={disabled}
                    onClick={() => void handleProviderChange(p)}
                    className={cn(
                      "flex items-center justify-between rounded-lg border px-4 py-3 text-sm font-medium transition",
                      active
                        ? "border-primary bg-primary/10 text-primary shadow-inner"
                        : "hover:border-primary/40 hover:bg-accent",
                      disabled && "cursor-default opacity-60 hover:border-border hover:bg-transparent",
                    )}
                  >
                    <span>{PROVIDER_LABEL[p]}</span>
                    {active ? (
                      <span className="text-[10px] uppercase">· active</span>
                    ) : !available ? (
                      <span className="text-[10px] uppercase text-muted-foreground">no key</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              {canManageConfig
                ? "Switches which LLM backend answers chats. Providers without a configured API key are disabled. Pick the model under “Assistant model”."
                : "The LLM provider is managed by an admin."}
            </p>
          </div>
        )}

        {/* DETAIL: Assistant model */}
        {section === "model" && (
          <div className="grid gap-3">
            {!settings?.llm.configured ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[12.5px] text-muted-foreground">
                Not configured.
              </div>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Chat model</span>
                  {modelsError ? (
                    <Select
                      value={settings.llm.deployment}
                      onValueChange={(v) => void handleModelChange(v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={settings.llm.deployment}>
                          {settings.llm.deployment}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : models === null ? (
                    <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-[12.5px] text-muted-foreground">
                      <Loader2 className="size-3.5 animate-spin" />
                      Loading deployments…
                    </div>
                  ) : (
                    <Select
                      value={settings.llm.deployment}
                      onValueChange={(v) => void handleModelChange(v)}
                      disabled={savingModel || !canManageConfig}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a model" />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  {modelsError
                    ? "Couldn't list models — showing the active model only. " + modelsError
                    : provider === "groq"
                      ? "Models available on Groq. Pick a tool-capable model like llama-3.3-70b-versatile."
                      : "Chat-capable deployments on this Azure OpenAI resource. Embedding and other non-chat models are hidden."}
                </p>
                <div className="text-[11.5px] text-muted-foreground">
                  Auth: {settings.llm.auth} · Source: {settings.llm.source ?? "—"}
                </div>
              </>
            )}
          </div>
        )}

        {/* DETAIL: Appearance */}
        {section === "appearance" && (
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(({ id, label, icon: Icon }) => {
              const active = theme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-xs transition",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "text-muted-foreground hover:border-primary/40 hover:bg-accent",
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {/* DETAIL: Users & access (super_admin only) */}
        {section === "access" && canManageUsers && user && (
          <UsersAccessSection currentUserId={user.id} />
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SnLogo } from "@/components/SnLogo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api } from "@/lib/api";

const APP_NAME = "ServiceNow MCP Assistant";

type AuthResult = { ok: true } | { ok: false; error: string };

interface Props {
  onLogin: (username: string, password: string) => Promise<AuthResult>;
  onRegister: (username: string, email: string, password: string) => Promise<AuthResult>;
}

type Mode = "login" | "signup";

export function LoginPage({ onLogin, onRegister }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  // Surface an error passed back from the Google callback (e.g. cancelled login).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("auth_error");
    if (authError) {
      setError(authError);
      params.delete("auth_error");
      const qs = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }
  }, []);

  // Ask the backend which sign-in methods are available.
  useEffect(() => {
    void api.auth
      .providers()
      .then((p) => setGoogleEnabled(!!p.google))
      .catch(() => setGoogleEnabled(false));
  }, []);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Enter a username and password.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy(true);
    const r =
      mode === "login"
        ? await onLogin(username.trim(), password)
        : await onRegister(username.trim(), email.trim(), password);
    setBusy(false);
    if (!r.ok) setError(r.error);
  };

  const isLogin = mode === "login";

  return (
    <TooltipProvider delayDuration={200}>
      <div className="relative flex min-h-full w-full items-center justify-center bg-gradient-to-br from-[hsl(195,30%,10%)] via-[hsl(200,35%,6%)] to-[hsl(210,40%,4%)] p-6 text-white/90">
        <div className="absolute right-4 top-4 [&_button]:text-white/70 [&_button:hover]:text-white">
          <ThemeToggle />
        </div>

        <div className="grid w-full max-w-md gap-6 rounded-2xl border border-white/10 bg-white/[0.03] p-8 shadow-2xl backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <SnLogo className="h-12 w-auto [filter:brightness(0)_invert(1)]" />
            <div>
              <div className="text-lg font-semibold tracking-tight text-white">
                {isLogin ? `Log in to ${APP_NAME}` : "Create your account"}
              </div>
              <div className="mt-1 text-[12.5px] text-white/60">
                {isLogin ? "Sign in to continue" : `Join ${APP_NAME}`}
              </div>
            </div>
          </div>

          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="auth-username" className="text-white/70">Username</Label>
              <Input
                id="auth-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-brand"
              />
            </div>

            {!isLogin && (
              <div className="grid gap-1.5">
                <Label htmlFor="auth-email" className="text-white/70">
                  Email <span className="text-white/40">(optional)</span>
                </Label>
                <Input
                  id="auth-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-brand"
                />
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="auth-password" className="text-white/70">Password</Label>
              <Input
                id="auth-password"
                type="password"
                autoComplete={isLogin ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-white/15 bg-white/5 text-white placeholder:text-white/40 focus-visible:ring-brand"
              />
              {!isLogin && (
                <p className="text-[11px] text-white/40">At least 8 characters.</p>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12.5px] text-rose-200">
                <ShieldAlert className="size-3.5 shrink-0" />
                {error}
              </div>
            )}

            <Button type="submit" size="lg" disabled={busy} className="mt-1">
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  {isLogin ? "Signing in…" : "Creating account…"}
                </>
              ) : isLogin ? (
                "Log in"
              ) : (
                "Sign up"
              )}
            </Button>
          </form>

          {googleEnabled && (
            <>
              <div className="flex items-center gap-3 text-[11px] uppercase tracking-wide text-white/40">
                <span className="h-px flex-1 bg-white/10" />
                or
                <span className="h-px flex-1 bg-white/10" />
              </div>
              <Button
                type="button"
                size="lg"
                variant="outline"
                onClick={() => {
                  window.location.href = `/api/auth/google/login?mode=${isLogin ? "signin" : "signup"}`;
                }}
                className="border-white/15 bg-white/5 text-white hover:bg-white/10"
              >
                {isLogin ? "Log in with Google" : "Sign up with Google"}
              </Button>
            </>
          )}

          <div className="text-center text-[12.5px] text-white/60">
            {isLogin ? (
              <>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="font-medium text-brand hover:underline"
                >
                  Create new account
                </button>
              </>
            ) : (
              <>
                Have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchMode("login")}
                  className="font-medium text-brand hover:underline"
                >
                  Log in
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

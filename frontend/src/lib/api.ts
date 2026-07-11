import type {
  AppSettings,
  CatalogTool,
  HealthResponse,
  McpProbeResult,
  McpServerConfig,
  McpServerInput,
  McpServerListResponse,
  ModelsResponse,
  RoleDefaults,
  ToolsResponse,
  User,
  UserInput,
  UserRole,
} from "@/types";

class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function req<T>(input: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(input, { credentials: "include", ...(init || {}) });
  if (!resp.ok) {
    let detail = `${resp.status} ${resp.statusText}`;
    try {
      const body = await resp.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* ignore */
    }
    if (resp.status === 401) {
      if (!input.startsWith("/api/auth/")) {
        onUnauthorized?.();
      }
      throw new UnauthorizedError(detail);
    }
    throw new Error(detail);
  }
  const text = await resp.text();
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as unknown as T;
  }
}

const json = (method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown) => ({
  method,
  headers: body ? { "Content-Type": "application/json" } : undefined,
  body: body ? JSON.stringify(body) : undefined,
});

export const api = {
  tools: () => req<ToolsResponse>("/api/tools"),
  health: () => req<HealthResponse>("/api/health"),

  settings: {
    get: () => req<AppSettings>("/api/settings"),
    models: () => req<ModelsResponse>("/api/settings/models"),
    setModel: (deployment: string) =>
      req<AppSettings>("/api/settings/model", json("PUT", { deployment })),
  },

  auth: {
    whoami: () => req<{ user: User }>("/api/auth/whoami"),
    login: (username: string, password: string) =>
      req<{ user: User }>("/api/auth/login", json("POST", { username, password })),
    register: (username: string, email: string, password: string) =>
      req<{ user: User }>("/api/auth/register", json("POST", { username, email, password })),
    logout: () => req<{ ok: true }>("/api/auth/logout", json("POST")),
    providers: () => req<{ local: boolean; google: boolean }>("/api/auth/providers"),
  },

  users: {
    list: () => req<{ users: User[] }>("/api/users"),
    add: (payload: UserInput) => req<User>("/api/users", json("POST", payload)),
    patch: (id: string, payload: UserInput) =>
      req<User>(`/api/users/${id}`, json("PATCH", payload)),
    remove: (id: string) => req<{ ok: true }>(`/api/users/${id}`, json("DELETE")),
    getTools: (id: string) => req<{ tool_ids: number[] }>(`/api/users/${id}/tools`),
    setTools: (id: string, toolIds: number[]) =>
      req<{ tool_ids: number[] }>(`/api/users/${id}/tools`, json("PUT", { tool_ids: toolIds })),
  },

  admin: {
    tools: () => req<{ tools: CatalogTool[] }>("/api/admin/tools"),
    syncTools: () => req<{ tools: CatalogTool[] }>("/api/admin/tools/sync", json("POST")),
    roleDefaults: {
      get: () => req<RoleDefaults>("/api/admin/role-defaults"),
      set: (role: UserRole, toolIds: number[]) =>
        req<{ role: UserRole; tool_ids: number[] }>(
          "/api/admin/role-defaults",
          json("PUT", { role, tool_ids: toolIds }),
        ),
    },
  },

  mcp: {
    list: () => req<McpServerListResponse>("/api/mcp/servers"),
    add: (payload: McpServerInput) =>
      req<McpServerConfig>("/api/mcp/servers", json("POST", payload)),
    patch: (id: string, payload: McpServerInput) =>
      req<McpServerConfig>(`/api/mcp/servers/${id}`, json("PATCH", payload)),
    remove: (id: string) =>
      req<{ ok: true }>(`/api/mcp/servers/${id}`, json("DELETE")),
    probe: (id: string) =>
      req<McpProbeResult>(`/api/mcp/servers/${id}/probe`, json("POST")),
  },
};

export { UnauthorizedError };

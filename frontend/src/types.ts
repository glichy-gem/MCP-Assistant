/** Types shared across the app. Mirror the SSE events emitted by backend/agent.py. */

export type Role = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  toolCalls?: ToolCallRecord[];
  createdAt: number;
}

export type ToolStatus = "running" | "done" | "error";

/** Provenance carried on tool events + records — which MCP server answered. */
export interface Provenance {
  server?: string | null;
}

export interface ToolCallRecord extends Provenance {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  preview?: string;
}

export type ChatEvent =
  | { type: "token"; text: string }
  | ({ type: "tool_call"; name: string; args: Record<string, unknown> } & Provenance)
  | ({ type: "tool_result"; name: string; ok: boolean; preview: string } & Provenance)
  | { type: "done" }
  | { type: "error"; message: string };

export interface ToolDescriptor {
  name: string;
  description: string;
}

/** Grouped by-server response from GET /api/tools. */
export interface ToolsPerServer {
  id: string;
  name: string;
  tools: ToolDescriptor[];
  status?: string;
}

export interface ToolsResponse {
  servers: ToolsPerServer[];
  count: number;
}

export interface HealthMcpServer {
  id: string;
  name: string;
  status: string;
  tools: number;
}

export interface HealthResponse {
  mcp_servers: HealthMcpServer[];
  total_tools: number;
  llm_configured: boolean;
  model: string;
}

/** MCP server config, redacted (api_key = "•••••abcd"). */
export interface McpServerConfig {
  id: string;
  name: string;
  endpoint: string;
  auth_header: string;
  api_key: string;
  enabled: boolean;
}

export interface McpServerListResponse {
  servers: McpServerConfig[];
}

/** POST/PATCH body. Empty api_key on PATCH = keep existing. */
export interface McpServerInput {
  name?: string;
  endpoint?: string;
  auth_header?: string;
  api_key?: string;
  enabled?: boolean;
}

export interface McpProbeResult {
  ok: boolean;
  tools: ToolDescriptor[];
  error?: string;
}

/* ---------- App settings ---------- */

export interface AppSettings {
  role: UserRole;
  can_manage_users: boolean;
  can_manage_config: boolean;
  llm: {
    configured: boolean;
    model: string;
  };
}

export interface ModelsResponse {
  deployments: string[];
  selected: string | null;
}

/** A discovered MCP tool in the RBAC catalog (GET /api/admin/tools). */
export interface CatalogTool {
  id: number;
  server_id: string;
  server_name: string;
  tool_name: string;
  qualified_name: string;
  description: string | null;
  is_available: boolean;
}

export type RoleDefaults = Record<UserRole, number[]>;

/* ---------- Auth + Users ---------- */

export type UserRole = "user" | "admin" | "super_admin";

export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: UserRole;
  is_active?: boolean;
  is_seed: boolean;
  created_at: string;
}

export type AuthStatus = "unknown" | "anonymous" | "authenticated";

export interface UserInput {
  username?: string;
  display_name?: string;
  email?: string | null;
  role?: UserRole;
  password?: string;
}

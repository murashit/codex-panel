export type ClassifiedAppServerLog = { kind: "plain"; text: string } | { kind: "error"; text: string } | null;

const ESCAPE_CHARACTER = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESCAPE_CHARACTER}\\[[0-?]*[ -/]*[@-~]`, "g");

export function classifyAppServerLog(message: string): ClassifiedAppServerLog {
  const normalized = stripAnsi(message).trimEnd();
  if (!normalized || isMcpTokenRefreshLog(normalized)) return null;
  const parsed = parseAppServerLog(normalized);
  if (!parsed) return null;

  const level = logString(parsed["level"]).toUpperCase();
  const parsedFields = parsed["fields"];
  const fields = parsedFields && typeof parsedFields === "object" ? (parsedFields as Record<string, unknown>) : {};
  const text = stripAnsi(logString(fields["message"], normalized));
  const target = logString(parsed["target"]);
  if (target.includes("rmcp::transport::worker") && isMcpTokenRefreshLog(text)) return null;
  if (target.includes("codex_core::tools::router") && text.includes("apply_patch verification failed")) return null;
  if (level === "ERROR") return { kind: "error", text };
  return null;
}

function parseAppServerLog(message: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(message) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function isMcpTokenRefreshLog(message: string): boolean {
  return message.includes("TokenRefreshFailed") || message.includes("Transport channel closed, when Auth");
}

function stripAnsi(message: string): string {
  return message.replace(ANSI_PATTERN, "");
}

function logString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

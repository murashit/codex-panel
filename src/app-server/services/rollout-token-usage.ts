import type { ThreadTokenUsage, TokenUsageBreakdown } from "../protocol/runtime-metrics";

export const ROLLOUT_TOKEN_USAGE_READ_TIMEOUT_MS = 2_000;
export const ROLLOUT_TOKEN_USAGE_MAX_BASE64_BYTES = 12 * 1024 * 1024;

export type RolloutReadFileBase64 = (path: string, options: { timeoutMs: number }) => Promise<string>;

export async function recoverRolloutTokenUsage(
  path: string | null,
  readFileBase64: RolloutReadFileBase64,
): Promise<ThreadTokenUsage | null> {
  if (!path || !isAbsolutePath(path)) return null;

  let dataBase64: string;
  try {
    dataBase64 = await readFileBase64(path, { timeoutMs: ROLLOUT_TOKEN_USAGE_READ_TIMEOUT_MS });
  } catch {
    return null;
  }
  if (dataBase64.length > ROLLOUT_TOKEN_USAGE_MAX_BASE64_BYTES) return null;

  const text = decodeBase64Text(dataBase64);
  return text ? parseRolloutTokenUsageJsonl(text) : null;
}

export function parseRolloutTokenUsageJsonl(text: string): ThreadTokenUsage | null {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }

    const usage = tokenUsageFromRolloutRecord(value);
    if (usage) return usage;
  }
  return null;
}

function tokenUsageFromRolloutRecord(value: unknown): ThreadTokenUsage | null {
  const record = objectRecord(value);
  if (record?.["type"] !== "event_msg") return null;
  const payload = objectRecord(record["payload"]);
  if (payload?.["type"] !== "token_count") return null;
  const info = objectRecord(payload["info"]);
  if (!info) return null;

  const last = tokenUsageBreakdownFromRecord(info["last_token_usage"]);
  const total = tokenUsageBreakdownFromRecord(info["total_token_usage"]);
  const modelContextWindow = nullableNonNegativeNumber(info["model_context_window"]);
  if (!last || !total || modelContextWindow === undefined) return null;

  return { last, total, modelContextWindow };
}

function tokenUsageBreakdownFromRecord(value: unknown): TokenUsageBreakdown | null {
  const record = objectRecord(value);
  if (!record) return null;
  const totalTokens = nonNegativeNumber(record["total_tokens"]);
  const inputTokens = nonNegativeNumber(record["input_tokens"]);
  const cachedInputTokens = nonNegativeNumber(record["cached_input_tokens"]);
  const outputTokens = nonNegativeNumber(record["output_tokens"]);
  const reasoningOutputTokens = nonNegativeNumber(record["reasoning_output_tokens"]);
  if (
    totalTokens === null ||
    inputTokens === null ||
    cachedInputTokens === null ||
    outputTokens === null ||
    reasoningOutputTokens === null
  ) {
    return null;
  }
  return { totalTokens, inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
}

function decodeBase64Text(dataBase64: string): string | null {
  try {
    const binary = atob(dataBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function nonNegativeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nullableNonNegativeNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return nonNegativeNumber(value) ?? undefined;
}

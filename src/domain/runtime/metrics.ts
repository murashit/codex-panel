export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  individualLimit: SpendControlLimitSnapshot | null;
  rateLimitReachedType: string | null;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface SpendControlLimitSnapshot {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt: number;
}

export interface ThreadTokenUsage {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  modelContextWindow: number | null;
}

export interface TokenUsageBreakdown {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface TokenUsageBreakdownInput {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

interface ThreadTokenUsageInput {
  total: TokenUsageBreakdownInput;
  last: TokenUsageBreakdownInput;
  modelContextWindow: number | null;
}

export function threadTokenUsageFromRuntimeUsage(usage: ThreadTokenUsageInput): ThreadTokenUsage {
  return {
    total: tokenUsageBreakdownFromRuntimeBreakdown(usage.total),
    last: tokenUsageBreakdownFromRuntimeBreakdown(usage.last),
    modelContextWindow: usage.modelContextWindow,
  };
}

function tokenUsageBreakdownFromRuntimeBreakdown(breakdown: TokenUsageBreakdownInput): TokenUsageBreakdown {
  return {
    totalTokens: breakdown.totalTokens,
    inputTokens: breakdown.inputTokens,
    cachedInputTokens: breakdown.cachedInputTokens,
    outputTokens: breakdown.outputTokens,
    reasoningOutputTokens: breakdown.reasoningOutputTokens,
  };
}

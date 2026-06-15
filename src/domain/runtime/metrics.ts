export interface RateLimitSnapshot {
  readonly limitId: string | null;
  readonly limitName: string | null;
  readonly primary: RateLimitWindow | null;
  readonly secondary: RateLimitWindow | null;
  readonly individualLimit: SpendControlLimitSnapshot | null;
  readonly rateLimitReachedType: string | null;
}

export interface RateLimitWindow {
  readonly usedPercent: number;
  readonly windowDurationMins: number | null;
  readonly resetsAt: number | null;
}

export interface SpendControlLimitSnapshot {
  readonly limit: string;
  readonly used: string;
  readonly remainingPercent: number;
  readonly resetsAt: number;
}

export interface ThreadTokenUsage {
  readonly total: TokenUsageBreakdown;
  readonly last: TokenUsageBreakdown;
  readonly modelContextWindow: number | null;
}

export interface TokenUsageBreakdown {
  readonly totalTokens: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
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

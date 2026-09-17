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

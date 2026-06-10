import type { RateLimitSnapshot as AppServerRateLimitSnapshot } from "../generated/app-server/v2/RateLimitSnapshot";
import type { RateLimitWindow as AppServerRateLimitWindow } from "../generated/app-server/v2/RateLimitWindow";
import type { SpendControlLimitSnapshot as AppServerSpendControlLimitSnapshot } from "../generated/app-server/v2/SpendControlLimitSnapshot";
import type { ThreadTokenUsage as AppServerThreadTokenUsage } from "../generated/app-server/v2/ThreadTokenUsage";
import type { TokenUsageBreakdown as AppServerTokenUsageBreakdown } from "../generated/app-server/v2/TokenUsageBreakdown";

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

export function rateLimitSnapshotFromAppServerSnapshot(snapshot: AppServerRateLimitSnapshot): RateLimitSnapshot {
  return {
    limitId: snapshot.limitId,
    limitName: snapshot.limitName,
    primary: snapshot.primary ? rateLimitWindowFromAppServerWindow(snapshot.primary) : null,
    secondary: snapshot.secondary ? rateLimitWindowFromAppServerWindow(snapshot.secondary) : null,
    individualLimit: snapshot.individualLimit ? spendControlLimitFromAppServerLimit(snapshot.individualLimit) : null,
    rateLimitReachedType: snapshot.rateLimitReachedType,
  };
}

export function threadTokenUsageFromAppServerUsage(usage: AppServerThreadTokenUsage): ThreadTokenUsage {
  return {
    total: tokenUsageBreakdownFromAppServerBreakdown(usage.total),
    last: tokenUsageBreakdownFromAppServerBreakdown(usage.last),
    modelContextWindow: usage.modelContextWindow,
  };
}

function rateLimitWindowFromAppServerWindow(window: AppServerRateLimitWindow): RateLimitWindow {
  return {
    usedPercent: window.usedPercent,
    windowDurationMins: window.windowDurationMins,
    resetsAt: window.resetsAt,
  };
}

function spendControlLimitFromAppServerLimit(limit: AppServerSpendControlLimitSnapshot): SpendControlLimitSnapshot {
  return {
    limit: limit.limit,
    used: limit.used,
    remainingPercent: limit.remainingPercent,
    resetsAt: limit.resetsAt,
  };
}

function tokenUsageBreakdownFromAppServerBreakdown(breakdown: AppServerTokenUsageBreakdown): TokenUsageBreakdown {
  return {
    totalTokens: breakdown.totalTokens,
    inputTokens: breakdown.inputTokens,
    cachedInputTokens: breakdown.cachedInputTokens,
    outputTokens: breakdown.outputTokens,
    reasoningOutputTokens: breakdown.reasoningOutputTokens,
  };
}

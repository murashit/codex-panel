import type { RateLimitSnapshot, RateLimitWindow, SpendControlLimitSnapshot } from "../../domain/runtime/metrics";

interface AppServerRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

interface AppServerSpendControlLimitSnapshot {
  limit: string;
  used: string;
  remainingPercent: number;
  resetsAt: number;
}

interface AppServerRateLimitSnapshot extends Record<string, unknown> {
  limitId: string | null;
  limitName: string | null;
  primary: AppServerRateLimitWindow | null;
  secondary: AppServerRateLimitWindow | null;
  individualLimit: AppServerSpendControlLimitSnapshot | null;
  rateLimitReachedType: string | null;
}

interface AppServerAccountRateLimitsResponse {
  rateLimits: AppServerRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, AppServerRateLimitSnapshot | undefined> | null;
}

function rateLimitSnapshotFromAppServerSnapshot(snapshot: AppServerRateLimitSnapshot): RateLimitSnapshot {
  return {
    limitId: snapshot.limitId,
    limitName: snapshot.limitName,
    primary: snapshot.primary ? rateLimitWindowFromAppServerWindow(snapshot.primary) : null,
    secondary: snapshot.secondary ? rateLimitWindowFromAppServerWindow(snapshot.secondary) : null,
    individualLimit: snapshot.individualLimit ? spendControlLimitFromAppServerLimit(snapshot.individualLimit) : null,
    rateLimitReachedType: snapshot.rateLimitReachedType,
  };
}

export function rateLimitSnapshotFromAccountRateLimitsResponse(response: AppServerAccountRateLimitsResponse): RateLimitSnapshot {
  return rateLimitSnapshotFromAppServerSnapshot(accountRateLimitSnapshotFromResponse(response));
}

export function accountRateLimitsSummaryFromResponse(response: AppServerAccountRateLimitsResponse): string {
  return response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available";
}

function accountRateLimitSnapshotFromResponse(response: AppServerAccountRateLimitsResponse): AppServerRateLimitSnapshot {
  const snapshots = response.rateLimitsByLimitId;
  const codexRateLimit = snapshots && Object.hasOwn(snapshots, "codex") ? snapshots["codex"] : undefined;
  return codexRateLimit ?? response.rateLimits;
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

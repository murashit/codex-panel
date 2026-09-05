import type { RateLimitSnapshot, RateLimitWindow, SpendControlLimitSnapshot } from "../../domain/runtime/metrics";
import type { GetAccountRateLimitsResponse } from "../../generated/app-server/v2/GetAccountRateLimitsResponse";
import type { RateLimitSnapshot as AppServerRateLimitSnapshot } from "../../generated/app-server/v2/RateLimitSnapshot";
import type { RateLimitWindow as AppServerRateLimitWindow } from "../../generated/app-server/v2/RateLimitWindow";
import type { SpendControlLimitSnapshot as AppServerSpendControlLimitSnapshot } from "../../generated/app-server/v2/SpendControlLimitSnapshot";

type AppServerAccountRateLimitsResponse = Pick<GetAccountRateLimitsResponse, "rateLimits" | "rateLimitsByLimitId">;

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
  const snapshots = response.rateLimitsByLimitId;
  const snapshot = (snapshots && Object.hasOwn(snapshots, "codex") ? snapshots["codex"] : undefined) ?? response.rateLimits;
  return rateLimitSnapshotFromAppServerSnapshot(snapshot);
}

export function accountRateLimitsSummaryFromResponse(response: AppServerAccountRateLimitsResponse): string {
  return response.rateLimitsByLimitId ? `${String(Object.keys(response.rateLimitsByLimitId).length)} limits` : "available";
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

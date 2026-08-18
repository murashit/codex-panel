export interface ActiveRouteScope {
  activeThreadId: string | null;
  activeTurnId: string | null;
}

export interface AppServerRouteScope {
  threadId: string | null;
  turnId: string | null;
}

export function isAppServerRouteScopeInActiveRouteScope(routeScope: AppServerRouteScope, activeScope: ActiveRouteScope): boolean {
  // A scoped message requires a panel that owns its thread. Unscoped messages remain
  // eligible for every panel, and turn lifecycle routing decides whether an idle owner
  // may adopt a newly started turn.
  if (routeScope.threadId && routeScope.threadId !== activeScope.activeThreadId) return false;
  if (routeScope.turnId && activeScope.activeTurnId && routeScope.turnId !== activeScope.activeTurnId) return false;
  return true;
}

export function isTurnScopedAppServerRouteForIdlePanelTurn(routeScope: AppServerRouteScope, activeScope: ActiveRouteScope): boolean {
  return activeScope.activeTurnId === null && routeScope.turnId !== null;
}

export function fallbackAppServerRouteScope(envelope: { params?: unknown }): AppServerRouteScope {
  const rawParams = envelope.params;
  const params =
    rawParams !== null && typeof rawParams === "object" && !Array.isArray(rawParams) ? (rawParams as Record<string, unknown>) : null;
  return {
    threadId: stringParam(params, "threadId"),
    turnId: stringParam(params, "turnId"),
  };
}

function stringParam(params: Record<string, unknown> | null, key: string): string | null {
  const value = params?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

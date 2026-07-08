export interface ActiveRouteScope {
  activeThreadId: string | null;
  activeTurnId: string | null;
}

export interface AppServerRouteScope {
  threadId: string | null;
  turnId: string | null;
}

export function isAppServerRouteScopeInActiveRouteScope(routeScope: AppServerRouteScope, activeScope: ActiveRouteScope): boolean {
  // Scope identifiers are filters only when both the app-server envelope and the active
  // panel have one. Thread catalog and idle-thread notifications often omit
  // active turn scope, so missing ids stay eligible for the active route.
  if (routeScope.threadId && activeScope.activeThreadId && routeScope.threadId !== activeScope.activeThreadId) return false;
  if (routeScope.turnId && activeScope.activeTurnId && routeScope.turnId !== activeScope.activeTurnId) return false;
  return true;
}

export function isTurnScopedAppServerRouteForIdleActiveThread(routeScope: AppServerRouteScope, activeScope: ActiveRouteScope): boolean {
  return activeScope.activeThreadId !== null && activeScope.activeTurnId === null && routeScope.turnId !== null;
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

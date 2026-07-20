export interface AppServerQueryContext {
  readonly codexPath: string;
  readonly vaultPath: string;
}

type AppServerQueryScope = readonly ["app-server", string, string];
export type AppServerActiveThreadsQueryKey = readonly [...AppServerQueryScope, "threads", "active"];
export type AppServerActiveThreadSearchInventoryQueryKey = readonly [...AppServerQueryScope, "threads", "active-search-inventory"];
export type AppServerArchivedThreadsQueryKey = readonly [...AppServerQueryScope, "threads", "archived"];
export type AppServerModelsQueryKey = readonly [...AppServerQueryScope, "models"];
export type AppServerRuntimeConfigQueryKey = readonly [...AppServerQueryScope, "runtime-config"];
export type AppServerSkillsQueryKey = readonly [...AppServerQueryScope, "skills"];
export type AppServerPermissionProfilesQueryKey = readonly [...AppServerQueryScope, "permission-profiles"];
export type AppServerRateLimitsQueryKey = readonly [...AppServerQueryScope, "rate-limits"];

function appServerQueryScope(context: AppServerQueryContext): AppServerQueryScope {
  return ["app-server", context.codexPath, context.vaultPath];
}

export function activeThreadsQueryKey(context: AppServerQueryContext): AppServerActiveThreadsQueryKey {
  return [...appServerQueryScope(context), "threads", "active"];
}

export function activeThreadSearchInventoryQueryKey(context: AppServerQueryContext): AppServerActiveThreadSearchInventoryQueryKey {
  return [...appServerQueryScope(context), "threads", "active-search-inventory"];
}

export function archivedThreadsQueryKey(context: AppServerQueryContext): AppServerArchivedThreadsQueryKey {
  return [...appServerQueryScope(context), "threads", "archived"];
}

export function appServerModelsQueryKey(context: AppServerQueryContext): AppServerModelsQueryKey {
  return [...appServerQueryScope(context), "models"];
}

export function appServerRuntimeConfigQueryKey(context: AppServerQueryContext): AppServerRuntimeConfigQueryKey {
  return [...appServerQueryScope(context), "runtime-config"];
}

export function appServerSkillsQueryKey(context: AppServerQueryContext): AppServerSkillsQueryKey {
  return [...appServerQueryScope(context), "skills"];
}

export function appServerPermissionProfilesQueryKey(context: AppServerQueryContext): AppServerPermissionProfilesQueryKey {
  return [...appServerQueryScope(context), "permission-profiles"];
}

export function appServerRateLimitsQueryKey(context: AppServerQueryContext): AppServerRateLimitsQueryKey {
  return [...appServerQueryScope(context), "rate-limits"];
}

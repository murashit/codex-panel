export interface AppServerQueryContext {
  readonly codexPath: string;
  readonly vaultPath: string;
}

type AppServerQueryScope = readonly ["app-server"];
export type AppServerActiveThreadsQueryKey = readonly [...AppServerQueryScope, "threads", "active"];
export type AppServerActiveThreadSearchInventoryQueryKey = readonly [...AppServerQueryScope, "threads", "active-search-inventory"];
export type AppServerArchivedThreadsQueryKey = readonly [...AppServerQueryScope, "threads", "archived"];
export type AppServerModelsQueryKey = readonly [...AppServerQueryScope, "models"];
export type AppServerRuntimeConfigQueryKey = readonly [...AppServerQueryScope, "runtime-config"];
export type AppServerSkillsQueryKey = readonly [...AppServerQueryScope, "skills"];
export type AppServerPermissionProfilesQueryKey = readonly [...AppServerQueryScope, "permission-profiles"];
export type AppServerRateLimitsQueryKey = readonly [...AppServerQueryScope, "rate-limits"];

const APP_SERVER_QUERY_SCOPE: AppServerQueryScope = ["app-server"];

export function activeThreadsQueryKey(): AppServerActiveThreadsQueryKey {
  return [...APP_SERVER_QUERY_SCOPE, "threads", "active"];
}

export function activeThreadSearchInventoryQueryKey(): AppServerActiveThreadSearchInventoryQueryKey {
  return [...APP_SERVER_QUERY_SCOPE, "threads", "active-search-inventory"];
}

export function archivedThreadsQueryKey(): AppServerArchivedThreadsQueryKey {
  return [...APP_SERVER_QUERY_SCOPE, "threads", "archived"];
}

export function appServerModelsQueryKey(): AppServerModelsQueryKey {
  return [...APP_SERVER_QUERY_SCOPE, "models"];
}

export function appServerRuntimeConfigQueryKey(): AppServerRuntimeConfigQueryKey {
  return [...APP_SERVER_QUERY_SCOPE, "runtime-config"];
}

export function appServerSkillsQueryKey(): AppServerSkillsQueryKey {
  return [...APP_SERVER_QUERY_SCOPE, "skills"];
}

export function appServerPermissionProfilesQueryKey(): AppServerPermissionProfilesQueryKey {
  return [...APP_SERVER_QUERY_SCOPE, "permission-profiles"];
}

export function appServerRateLimitsQueryKey(): AppServerRateLimitsQueryKey {
  return [...APP_SERVER_QUERY_SCOPE, "rate-limits"];
}

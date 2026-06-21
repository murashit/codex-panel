import type { AppServerClient } from "./client";

export type AppServerClientRequestPolicy = { kind: "interactive" } | { kind: "reject"; message: string };

export interface AppServerClientAccessOptions {
  serverRequests?: AppServerClientRequestPolicy;
}

export interface AppServerClientAccess {
  withClient<T>(operation: (client: AppServerClient) => Promise<T>, options?: AppServerClientAccessOptions): Promise<T>;
}

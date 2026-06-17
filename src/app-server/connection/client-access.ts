import type { AppServerClient } from "./client";

export interface AppServerClientAccess {
  withClient<T>(operation: (client: AppServerClient) => Promise<T>, options?: { unhandledServerRequestMessage?: string }): Promise<T>;
}

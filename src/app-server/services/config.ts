import type { ClientResponseByMethod } from "../connection/client";
import type { AppServerRequestClient } from "./request-client";

export function readEffectiveConfig(client: AppServerRequestClient, cwd: string): Promise<ClientResponseByMethod["config/read"]> {
  return client.request("config/read", { cwd, includeLayers: true });
}

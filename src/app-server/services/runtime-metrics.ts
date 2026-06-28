import type { ClientResponseByMethod } from "../connection/client";
import type { AppServerRequestClient } from "./request-client";

export function readAccountRateLimits(client: AppServerRequestClient): Promise<ClientResponseByMethod["account/rateLimits/read"]> {
  return client.request("account/rateLimits/read", undefined);
}

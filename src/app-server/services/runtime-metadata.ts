import type { ApprovalsReviewer } from "../../domain/runtime/settings";
import type { ClientResponseByMethod } from "../connection/client";
import type { AppServerRequestClient } from "./request-client";

export function readEffectiveConfig(client: AppServerRequestClient, cwd: string): Promise<ClientResponseByMethod["config/read"]> {
  return client.request("config/read", { cwd, includeLayers: true });
}

export function readAccountRateLimits(client: AppServerRequestClient): Promise<ClientResponseByMethod["account/rateLimits/read"]> {
  return client.request("account/rateLimits/read", undefined);
}

export async function readAllowedApprovalsReviewers(
  client: AppServerRequestClient,
): Promise<readonly ApprovalsReviewer[] | null | undefined> {
  try {
    const response = await client.request("configRequirements/read", undefined);
    return response.requirements?.allowedApprovalsReviewers ?? null;
  } catch {
    // Unavailable requirements do not make effective configuration unavailable.
    // Codex still validates every submitted change.
    return undefined;
  }
}

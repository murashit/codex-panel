import type { RuntimeServiceTierRequest, RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";

interface ThreadStartRequest {
  serviceTier?: RuntimeServiceTierRequest;
  permissions?: RuntimeSettingsPatch["permissions"];
}

export interface ThreadStartTransport {
  startThread(request: ThreadStartRequest): Promise<ThreadActivationSnapshot | null>;
}

import type { RuntimeServiceTierRequest, RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";
import type { ThreadActivationSnapshot } from "../../../../domain/threads/activation";
import type { EffectOutcome } from "../effect-outcome";

interface ThreadStartRequest {
  serviceTier?: RuntimeServiceTierRequest;
  permissions?: RuntimeSettingsPatch["permissions"];
}

export interface ThreadStartPort {
  startThread(request: ThreadStartRequest): Promise<EffectOutcome<ThreadActivationSnapshot>>;
}

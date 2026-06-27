import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";

export interface RuntimeSettingsTransport {
  updateThreadSettings(threadId: string, update: RuntimeSettingsPatch): Promise<boolean>;
}

import type { RuntimeSettingsPatch } from "../../../../domain/runtime/thread-settings";

export interface RuntimeSettingsPort {
  updateThreadSettings(threadId: string, update: RuntimeSettingsPatch): Promise<boolean>;
}

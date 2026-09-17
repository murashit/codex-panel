import type { RuntimeSettingsPatch } from "../../domain/runtime/settings";
import type { ThreadSettingsUpdateParams } from "../../generated/app-server/v2/ThreadSettingsUpdateParams";

type AppServerRuntimeSettingsPatch = Pick<ThreadSettingsUpdateParams, keyof RuntimeSettingsPatch>;

export function appServerRuntimeSettingsPatch(update: RuntimeSettingsPatch): AppServerRuntimeSettingsPatch {
  const { collaborationMode, ...settings } = update;
  if (!("collaborationMode" in update)) return settings;
  return {
    ...settings,
    collaborationMode: collaborationMode
      ? {
          mode: collaborationMode.mode,
          settings: {
            model: collaborationMode.settings.model,
            reasoning_effort: collaborationMode.settings.reasoningEffort,
            developer_instructions: collaborationMode.settings.developerInstructions,
          },
        }
      : null,
  };
}

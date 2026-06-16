import type { RuntimeSettingsPatch } from "../../domain/runtime/thread-settings";

type AppServerRuntimeSettingsPatch = Omit<RuntimeSettingsPatch, "collaborationMode"> & {
  collaborationMode?: {
    mode: "plan" | "default";
    settings: {
      model: string;
      reasoning_effort: string | null;
      developer_instructions: string | null;
    };
  } | null;
};

export function appServerRuntimeSettingsPatch(update: RuntimeSettingsPatch): AppServerRuntimeSettingsPatch {
  const { collaborationMode, ...settings } = update;
  return {
    ...settings,
    ...("collaborationMode" in update
      ? {
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
        }
      : {}),
  };
}

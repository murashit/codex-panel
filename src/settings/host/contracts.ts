import type { SettingsResources } from "../application/resources";
import type { CodexPanelSettings } from "../preferences";

export interface SettingsTabHost {
  settings: CodexPanelSettings;
  readonly resources: SettingsResources;
  publishSettings(settings: CodexPanelSettings): Promise<{ replacementResources: SettingsResources | null }>;
}

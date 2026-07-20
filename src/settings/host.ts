import type { SettingsDynamicDataAccess } from "./dynamic-data";
import type { CodexPanelSettings } from "./model";

export interface SettingsDynamicSectionsHost {
  settings: CodexPanelSettings;
  readonly dynamicData: SettingsDynamicDataAccess;
}

export interface CodexPanelSettingTabHost extends SettingsDynamicSectionsHost {
  publishSettings(settings: CodexPanelSettings): Promise<{ replacementDynamicData: SettingsDynamicDataAccess | null }>;
}

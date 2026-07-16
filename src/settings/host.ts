import type { SettingsDynamicDataAccess } from "./dynamic-data";
import type { CodexPanelSettings } from "./model";

export interface SettingsDynamicSectionsHost {
  settings: CodexPanelSettings;
  dynamicData: SettingsDynamicDataAccess;
}

export interface CodexPanelSettingTabHost extends SettingsDynamicSectionsHost {
  publishSettings(settings: CodexPanelSettings): Promise<{ appServerContextReplaced: boolean }>;
}

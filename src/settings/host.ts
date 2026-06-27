import type { SettingsDynamicDataAccess } from "./dynamic-data";
import type { CodexPanelSettings } from "./model";

export interface SettingsDynamicSectionsHost {
  settings: CodexPanelSettings;
  dynamicData: SettingsDynamicDataAccess;
}

export interface CodexPanelSettingTabHost extends SettingsDynamicSectionsHost {
  saveSettings(): Promise<void>;
  refreshOpenViews(): void;
}

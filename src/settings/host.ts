import type { AppServerSharedQueries } from "../app-server/query/shared-queries";
import type { CodexPanelSettings } from "./model";
import type { ActiveThreadCatalogThreadRestores } from "../workspace/active-thread-catalog";

export interface SettingsDynamicDataHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  appServerData: Pick<
    AppServerSharedQueries,
    "modelsSnapshot" | "observeModelsResult" | "fetchModels" | "refreshModels" | "notifyContextChanged"
  >;
  threadCatalog: ActiveThreadCatalogThreadRestores;
}

export interface CodexPanelSettingTabHost extends SettingsDynamicDataHost {
  saveSettings(): Promise<void>;
  refreshOpenViews(): void;
}

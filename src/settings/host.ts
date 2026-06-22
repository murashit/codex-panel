import type { AppServerClientAccess } from "../app-server/connection/client-access";
import type { ModelMetadata } from "../domain/catalog/metadata";
import type { ObservedDataListener } from "../domain/observed-data";
import type { CodexPanelSettings } from "./model";
import type { ThreadCatalogArchivedReader, ThreadCatalogThreadDeletes, ThreadCatalogThreadRestores } from "../workspace/thread-catalog";

interface SettingsAppServerData {
  modelsSnapshot(): readonly ModelMetadata[] | null;
  observeModelsResult(listener: ObservedDataListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
  notifyContextChanged(): void;
}

export interface SettingsDynamicDataHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  clientAccess: AppServerClientAccess;
  appServerData: SettingsAppServerData;
  threadCatalog: ThreadCatalogArchivedReader & ThreadCatalogThreadDeletes & ThreadCatalogThreadRestores;
}

export interface CodexPanelSettingTabHost extends SettingsDynamicDataHost {
  saveSettings(): Promise<void>;
  refreshOpenViews(): void;
}

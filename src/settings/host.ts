import type { AppServerClientAccess } from "../app-server/connection/client-access";
import type { ThreadCatalogArchivedReader, ThreadCatalogEventSink } from "../app-server/thread-catalog";
import type { ModelMetadata } from "../domain/catalog/metadata";
import type { ObservedResultListener } from "../domain/observed-result";
import type { CodexPanelSettings } from "./model";

interface SettingsAppServerQueries {
  modelsSnapshot(): readonly ModelMetadata[] | null;
  observeModelsResult(listener: ObservedResultListener<readonly ModelMetadata[]>, options?: { emitCurrent?: boolean }): () => void;
  fetchModels(): Promise<readonly ModelMetadata[]>;
  refreshModels(): Promise<readonly ModelMetadata[]>;
  notifyContextChanged(): void;
}

export interface SettingsDynamicSectionsHost {
  settings: CodexPanelSettings;
  vaultPath: string;
  clientAccess: AppServerClientAccess;
  appServerQueries: SettingsAppServerQueries;
  threadCatalog: ThreadCatalogArchivedReader & ThreadCatalogEventSink;
}

export interface CodexPanelSettingTabHost extends SettingsDynamicSectionsHost {
  saveSettings(): Promise<void>;
  refreshOpenViews(): void;
}

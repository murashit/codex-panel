import type { ComponentChild as UiNode } from "preact";

import type { ModelMetadata, ReasoningEffort } from "../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../domain/catalog/metadata";
import { ObsidianDropdown } from "./controls.obsidian";
import { SELECTION_REWRITE_SETTING, THREAD_NAMING_SETTING } from "./definitions";
import { SettingRow, SettingsGroup, SettingsHeading, SettingsItems } from "./layout";
import type { PanelHelpersViewModel } from "./view-model";

const CODEX_DEFAULT_VALUE = "__codex-default__";

export function PanelHelpersSection({ state }: { state: PanelHelpersViewModel }): UiNode {
  return (
    <SettingsGroup className="codex-panel-settings__section codex-panel-settings__helper-section">
      <SettingsHeading name="Panel helpers" />
      <SettingsItems>
        <ModelEffortControl
          name={THREAD_NAMING_SETTING.name}
          desc={THREAD_NAMING_SETTING.desc}
          modelValue={state.threadNamingModel}
          effortValue={state.threadNamingEffort}
          models={state.models}
          onModelChange={state.onThreadNamingModelChange}
          onEffortChange={state.onThreadNamingEffortChange}
        />
        <ModelEffortControl
          name={SELECTION_REWRITE_SETTING.name}
          desc={SELECTION_REWRITE_SETTING.desc}
          modelValue={state.rewriteSelectionModel}
          effortValue={state.rewriteSelectionEffort}
          models={state.models}
          onModelChange={state.onRewriteSelectionModelChange}
          onEffortChange={state.onRewriteSelectionEffortChange}
        />
      </SettingsItems>
      {state.modelError ? <p className="setting-item-description codex-panel-settings__section-status">{state.modelError}</p> : null}
    </SettingsGroup>
  );
}

export function ModelEffortControl({
  name,
  desc,
  modelValue,
  effortValue,
  models,
  onModelChange,
  onEffortChange,
  controlsOnly = false,
}: {
  name: string;
  desc: string;
  modelValue: string | null;
  effortValue: ReasoningEffort | null;
  models: readonly ModelMetadata[];
  onModelChange: (value: string | null) => void;
  onEffortChange: (value: ReasoningEffort | null) => void;
  controlsOnly?: boolean;
}): UiNode {
  const efforts = reasoningEffortsForSelectedModel(models, modelValue);
  const controls = (
    <>
      <ObsidianDropdown
        value={modelValue ?? CODEX_DEFAULT_VALUE}
        onChange={(value) => {
          onModelChange(value === CODEX_DEFAULT_VALUE ? null : value);
        }}
        options={modelSelectOptions(models, modelValue)}
      />
      <ObsidianDropdown
        value={effortValue ?? CODEX_DEFAULT_VALUE}
        onChange={(value) => {
          onEffortChange(value === CODEX_DEFAULT_VALUE ? null : value);
        }}
        options={reasoningEffortSelectOptions(efforts, effortValue)}
      />
    </>
  );
  return controlsOnly ? (
    controls
  ) : (
    <SettingRow name={name} desc={desc}>
      {controls}
    </SettingRow>
  );
}

function modelSelectOptions(models: readonly ModelMetadata[], current: string | null): { value: string; label: string }[] {
  const options = [{ value: CODEX_DEFAULT_VALUE, label: "Codex default" }];
  if (current && !models.some((model) => model.model === current || model.id === current)) {
    options.push({ value: current, label: `${current} (saved)` });
  }
  for (const model of models) {
    options.push({ value: model.model, label: model.model });
  }
  return options;
}

function reasoningEffortSelectOptions(
  efforts: readonly ReasoningEffort[],
  current: ReasoningEffort | null,
): { value: string; label: string }[] {
  const options = [{ value: CODEX_DEFAULT_VALUE, label: "Codex default" }];
  if (current && !efforts.includes(current)) {
    options.push({ value: current, label: `${current} (saved)` });
  }
  for (const effort of efforts) {
    options.push({ value: effort, label: effort });
  }
  return options;
}

function reasoningEffortsForSelectedModel(models: readonly ModelMetadata[], modelIdOrName: string | null): ReasoningEffort[] {
  const model = findModelMetadataByIdOrName(models, modelIdOrName);
  return model ? supportedEffortsForModelMetadata(model) : [];
}

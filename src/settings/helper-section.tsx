import type { ComponentChild as UiNode } from "preact";

import type { ModelMetadata, ReasoningEffort } from "../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../domain/catalog/metadata";
import type { HelperSettingsState } from "./section-state";
import { SelectControl, SettingRow, SettingsHeading } from "./setting-components";

const CODEX_DEFAULT_VALUE = "__codex-default__";

export function HelperSettingsSection({ state }: { state: HelperSettingsState }): UiNode {
  return (
    <section className="codex-panel-settings__section codex-panel-settings__helper-section">
      <SettingsHeading name="Codex helpers" />
      <ModelEffortSetting
        name="Automatic thread naming"
        desc="Choose the model and reasoning effort used to suggest thread names."
        modelValue={state.threadNamingModel}
        effortValue={state.threadNamingEffort}
        models={state.models}
        onModelChange={state.onThreadNamingModelChange}
        onEffortChange={state.onThreadNamingEffortChange}
      />
      <ModelEffortSetting
        name="Selection rewrite"
        desc="Choose the model and reasoning effort used by rewrite selection."
        modelValue={state.rewriteSelectionModel}
        effortValue={state.rewriteSelectionEffort}
        models={state.models}
        onModelChange={state.onRewriteSelectionModelChange}
        onEffortChange={state.onRewriteSelectionEffortChange}
      />
      {state.modelLoadFailed ? <p className="setting-item-description codex-panel-settings__section-status">{state.modelStatus}</p> : null}
    </section>
  );
}

function ModelEffortSetting({
  name,
  desc,
  modelValue,
  effortValue,
  models,
  onModelChange,
  onEffortChange,
}: {
  name: string;
  desc: string;
  modelValue: string | null;
  effortValue: ReasoningEffort | null;
  models: readonly ModelMetadata[];
  onModelChange: (value: string | null) => void;
  onEffortChange: (value: ReasoningEffort | null) => void;
}): UiNode {
  const efforts = reasoningEffortsForSelectedModel(models, modelValue);
  return (
    <SettingRow name={name} desc={desc}>
      <SelectControl
        value={modelValue ?? CODEX_DEFAULT_VALUE}
        onChange={(value) => {
          onModelChange(value === CODEX_DEFAULT_VALUE ? null : value);
        }}
        options={modelSelectOptions(models, modelValue)}
      />
      <SelectControl
        value={effortValue ?? CODEX_DEFAULT_VALUE}
        onChange={(value) => {
          onEffortChange(value === CODEX_DEFAULT_VALUE ? null : value);
        }}
        options={reasoningEffortSelectOptions(efforts, effortValue)}
      />
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

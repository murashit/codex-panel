import type { ComponentChild as UiNode } from "preact";

import type { ModelMetadata, ReasoningEffort } from "../../domain/catalog/metadata";
import { findModelMetadataByIdOrName, supportedEffortsForModelMetadata } from "../../domain/catalog/metadata";
import { ObsidianDropdown } from "./controls.obsidian";

const CODEX_DEFAULT_VALUE = "__codex-default__";

export function ModelEffortControl({
  modelValue,
  effortValue,
  models,
  onModelChange,
  onEffortChange,
}: {
  modelValue: string | null;
  effortValue: ReasoningEffort | null;
  models: readonly ModelMetadata[];
  onModelChange: (value: string | null) => void;
  onEffortChange: (value: ReasoningEffort | null) => void;
}): UiNode {
  const efforts = reasoningEffortsForSelectedModel(models, modelValue);
  return (
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

import type { ModelMetadata } from "../../src/domain/runtime/catalog";

export function modelMetadataFixture(model: string, overrides: Partial<ModelMetadata> = {}): ModelMetadata {
  return {
    id: model,
    model,
    displayName: model,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [{ reasoningEffort: "high", description: "" }],
    defaultReasoningEffort: "high",
    inputModalities: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: true,
    ...overrides,
  };
}

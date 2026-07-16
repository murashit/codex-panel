import { describe, expect, it, vi } from "vitest";

import type { ModelMetadataClient } from "../../src/app-server/services/catalog";
import { resolvedRuntimeOverrideForClient } from "../../src/app-server/services/runtime-overrides";
import type { ModelListResponse } from "../../src/generated/app-server/v2/ModelListResponse";

describe("resolvedRuntimeOverrideForClient", () => {
  it("uses Codex defaults without loading model metadata", async () => {
    const client = modelClient([]);

    await expect(resolvedRuntimeOverrideForClient(client, { model: null, effort: null })).resolves.toEqual({});
    expect(client.request).not.toHaveBeenCalled();
  });

  it("passes a model-only override without loading model metadata", async () => {
    const client = modelClient([]);

    await expect(resolvedRuntimeOverrideForClient(client, { model: "gpt-5.4-mini", effort: null })).resolves.toEqual({
      model: "gpt-5.4-mini",
    });
    expect(client.request).not.toHaveBeenCalled();
  });

  it("keeps only efforts supported by the selected model", async () => {
    const client = modelClient([appServerModel("gpt-5.4-mini", ["low", "medium", "high"])]);

    await expect(resolvedRuntimeOverrideForClient(client, { model: "gpt-5.4-mini", effort: "minimal" })).resolves.toEqual({
      model: "gpt-5.4-mini",
    });
    await expect(resolvedRuntimeOverrideForClient(client, { model: "gpt-5.4-mini", effort: "low" })).resolves.toEqual({
      model: "gpt-5.4-mini",
      effort: "low",
    });
  });

  it("preserves explicit settings when model metadata cannot be loaded", async () => {
    const request = vi.fn(async () => {
      throw new Error("unavailable");
    }) as unknown as ModelMetadataClient["request"];

    await expect(resolvedRuntimeOverrideForClient({ request }, { model: "gpt-5.4-mini", effort: "minimal" })).resolves.toEqual({
      model: "gpt-5.4-mini",
      effort: "minimal",
    });
  });
});

function modelClient(models: ModelListResponse["data"]): ModelMetadataClient {
  return {
    request: vi.fn(async () => ({ data: models, nextCursor: null })) as unknown as ModelMetadataClient["request"],
  };
}

function appServerModel(name: string, efforts: string[]): ModelListResponse["data"][number] {
  return {
    id: name,
    model: name,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: name,
    description: "",
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort: reasoningEffort as never,
      label: reasoningEffort,
      description: "",
    })),
    defaultReasoningEffort: (efforts[0] ?? "low") as never,
    inputModalities: ["text"],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    serviceTiers: [],
    defaultServiceTier: null,
    isDefault: false,
  };
}

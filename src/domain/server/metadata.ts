import type { ModelMetadata, SkillMetadata } from "../catalog/metadata";
import type { RuntimeConfigSnapshot } from "../runtime/config";
import type { RateLimitSnapshot } from "../runtime/metrics";
import type { Diagnostics } from "./diagnostics";

export interface SharedServerMetadata {
  runtimeConfig: RuntimeConfigSnapshot | null;
  availableModels: readonly ModelMetadata[];
  availableSkills: readonly SkillMetadata[];
  rateLimit: RateLimitSnapshot | null;
  serverDiagnostics: Diagnostics;
}

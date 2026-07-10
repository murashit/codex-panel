import type { SkillMetadata } from "../catalog/metadata";
import type { RuntimeConfigSnapshot } from "../runtime/config";
import type { RateLimitSnapshot } from "../runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../runtime/permissions";
import type { Diagnostics } from "./diagnostics";

export interface SharedServerMetadata {
  runtimeConfig: RuntimeConfigSnapshot | null;
  availableSkills: readonly SkillMetadata[];
  availablePermissionProfiles: readonly RuntimePermissionProfileSummary[];
  rateLimit: RateLimitSnapshot | null;
  serverDiagnostics: Diagnostics;
}

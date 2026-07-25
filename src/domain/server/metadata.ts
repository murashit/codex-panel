import type { ModelMetadata, SkillMetadata } from "../catalog/metadata";
import type { RuntimeConfigSnapshot } from "../runtime/config";
import type { RateLimitSnapshot } from "../runtime/metrics";
import type { RuntimePermissionProfileSummary } from "../runtime/permissions";
import type { DiagnosticProbeResult } from "./diagnostics";

export type SharedServerMetadataResource =
  | { readonly id: "runtimeConfig"; readonly value: RuntimeConfigSnapshot | undefined }
  | {
      readonly id: "models";
      readonly value: readonly ModelMetadata[] | undefined;
      readonly probe: DiagnosticProbeResult;
    }
  | {
      readonly id: "skills";
      readonly value: readonly SkillMetadata[] | undefined;
      readonly probe: DiagnosticProbeResult;
    }
  | {
      readonly id: "permissionProfiles";
      readonly value: readonly RuntimePermissionProfileSummary[] | undefined;
      readonly probe: DiagnosticProbeResult;
    }
  | {
      readonly id: "rateLimits";
      readonly value: RateLimitSnapshot | null | undefined;
      readonly probe: DiagnosticProbeResult;
    };

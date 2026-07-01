import type { ModelMetadata } from "../../../../domain/catalog/metadata";
import type { ApprovalsReviewer, ServiceTier } from "../../../../domain/runtime/policy";
import type { PendingRuntimeIntent, RequestedFastMode } from "./intent";
import type { RuntimeLayeredValue, RuntimeValueSource } from "./layered-value";

export interface FastModeResolution {
  readonly requested: PendingRuntimeIntent<RequestedFastMode>;
  readonly active: boolean;
  readonly confirmedActive: boolean;
  readonly source: RuntimeValueSource;
  readonly confirmedSource: RuntimeValueSource;
  readonly effectiveServiceTier: ServiceTier | null;
  readonly confirmedServiceTier: ServiceTier | null;
  readonly serviceTierRequestValue: string;
}

export interface AutoReviewResolution {
  readonly active: boolean;
  readonly confirmedActive: boolean;
  readonly source: RuntimeValueSource;
  readonly confirmedSource: RuntimeValueSource;
}

export function resolveAutoReview(reviewer: RuntimeLayeredValue<ApprovalsReviewer>): AutoReviewResolution {
  return {
    active: autoReviewActive(reviewer.effective),
    confirmedActive: autoReviewActive(reviewer.confirmed),
    source: reviewer.source,
    confirmedSource: reviewer.confirmedSource,
  };
}

export function resolveFastMode(
  requested: PendingRuntimeIntent<RequestedFastMode>,
  serviceTier: RuntimeLayeredValue<ServiceTier>,
  serviceTiers: ModelMetadata["serviceTiers"],
): FastModeResolution {
  return {
    requested,
    active: isFastServiceTier(serviceTier.effective, serviceTiers),
    confirmedActive: isFastServiceTier(serviceTier.confirmed, serviceTiers),
    source: serviceTier.source,
    confirmedSource: serviceTier.confirmedSource,
    effectiveServiceTier: serviceTier.effective,
    confirmedServiceTier: serviceTier.confirmed,
    serviceTierRequestValue: serviceTiers.find((tier) => tier.name.trim().toLowerCase() === "fast")?.id ?? "fast",
  };
}

function autoReviewActive(value: ApprovalsReviewer | null): boolean {
  return value === "auto_review" || value === "guardian_subagent";
}

function isFastServiceTier(value: string | null | undefined, serviceTiers: ModelMetadata["serviceTiers"]): boolean {
  if (!value) return false;
  if (value === "fast") return true;
  if (serviceTiers.length === 0) return value === "priority";
  return serviceTiers.some((tier) => tier.id === value && tier.name.trim().toLowerCase() === "fast");
}

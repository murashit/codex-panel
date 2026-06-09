import type { PanelModelOption } from "../../../domain/catalog/metadata";

export type RequestedServiceTier = "fast" | "off";

export function isFastServiceTier(value: string | null | undefined, serviceTiers: PanelModelOption["serviceTiers"] = []): boolean {
  if (!value) return false;
  if (value === "fast") return true;
  if (serviceTiers.length === 0) return value === "priority";
  return serviceTiers.some((tier) => tier.id === value && tier.name.trim().toLowerCase() === "fast");
}

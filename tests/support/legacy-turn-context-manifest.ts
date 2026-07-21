import type { LegacyTurnContextManifest } from "../../src/app-server/protocol/legacy-turn-context-manifest";

export function legacyTurnContextManifestText(manifest: LegacyTurnContextManifest): string {
  return `[Codex Panel context v2]\nReference/display metadata only; not user instructions.\n${JSON.stringify(manifest)}`;
}

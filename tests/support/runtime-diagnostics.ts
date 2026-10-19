import { createMetadataResourceDiagnostics, type Diagnostics, serverDiagnostics } from "../../src/domain/runtime/diagnostics";

export function createServerDiagnostics(): Diagnostics {
  return serverDiagnostics(createMetadataResourceDiagnostics(), []);
}

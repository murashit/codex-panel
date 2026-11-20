import { describe, expect, it } from "vitest";

import { diagnosticProbeError, serverIdentity, serverPlatform, shortDiagnosticErrorMessage } from "../../../src/domain/runtime/diagnostics";
import type { ServerInitialization } from "../../../src/domain/runtime/metadata";

describe("server diagnostics", () => {
  it("formats initialize metadata", () => {
    const response = {
      userAgent: "codex-cli/0.128.0",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "macos",
    } satisfies ServerInitialization;

    expect(serverIdentity(response)).toBe("codex-cli/0.128.0");
    expect(serverPlatform(response)).toBe("macos/unix");
    expect(serverIdentity(null)).toBe("(not connected)");
    expect(serverPlatform(null)).toBe("(not connected)");
  });

  it("shortens diagnostic error messages", () => {
    expect(diagnosticProbeError("a\n b\t c", 1).message).toBe("a b c");
    expect(diagnosticProbeError("x".repeat(200), 1).message).toHaveLength(160);

    expect(shortDiagnosticErrorMessage("1234567890", 10)).toBe("1234567890");
  });
});

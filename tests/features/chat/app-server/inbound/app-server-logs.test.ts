import { describe, expect, it } from "vitest";

import { classifyAppServerLog } from "../../../../../src/features/chat/app-server/inbound/app-server-logs";

describe("app-server log classification", () => {
  it("suppresses non-JSON app-server stderr", () => {
    expect(
      classifyAppServerLog(
        "\u001b[2m2026-05-08T01:27:27.101140Z\u001b[0m \u001b[31mERROR\u001b[0m \u001b[2mcodex_core::tools::router\u001b[0m\u001b[2m:\u001b[0m \u001b[3merror\u001b[0m\u001b[2m=\u001b[0mapply_patch verification failed",
      ),
    ).toBeNull();
    expect(
      classifyAppServerLog(
        "src/generated/app-server/: codex app-server generate-ts --out src/generated/app-serverで生成した型。手編集しない。",
      ),
    ).toBeNull();
  });

  it.each(["TokenRefreshFailed", "Transport channel closed, when Auth"])("suppresses structured token refresh failures: %s", (message) => {
    expect(classifyAppServerLog(JSON.stringify({ level: "ERROR", fields: { message }, target: "rmcp::transport::worker" }))).toBeNull();
  });

  it("classifies JSON app-server errors", () => {
    expect(classifyAppServerLog(JSON.stringify({ level: "ERROR", fields: { message: "boom" }, target: "codex" }))).toEqual({
      kind: "error",
      text: "boom",
    });
  });

  it("renders structured JSON log fields without object stringification", () => {
    expect(
      classifyAppServerLog(
        JSON.stringify({
          level: "ERROR",
          fields: { message: { error: "boom" } },
          target: { crate: "codex" },
        }),
      ),
    ).toEqual({
      kind: "error",
      text: '{"error":"boom"}',
    });
  });

  it("suppresses structured apply_patch router verification logs", () => {
    expect(
      classifyAppServerLog(
        JSON.stringify({
          level: "ERROR",
          fields: { message: "apply_patch verification failed: Failed to find expected lines" },
          target: "codex_core::tools::router",
        }),
      ),
    ).toBeNull();
  });
});

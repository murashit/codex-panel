import { describe, expect, it } from "vitest";

import { appServerIdentity, appServerPlatform, compatibilitySummary, createAppServerCompatibility } from "../src/app-server/compatibility";
import type { InitializeResponse } from "../src/generated/app-server/InitializeResponse";

describe("app-server compatibility", () => {
  it("formats initialize metadata", () => {
    const response = {
      userAgent: "codex-cli/0.128.0",
      codexHome: "/tmp/codex",
      platformFamily: "unix",
      platformOs: "macos",
    } satisfies InitializeResponse;

    expect(appServerIdentity(response)).toBe("codex-cli/0.128.0");
    expect(appServerPlatform(response)).toBe("macos/unix");
  });

  it("formats lightweight probe status", () => {
    const compatibility = createAppServerCompatibility();
    expect(compatibilitySummary(compatibility)).toBe("model/list unknown; Plan mode uses experimental collaborationMode override");

    compatibility.modelList = "failed";
    compatibility.modelListError = "Unsupported app-server request";
    expect(compatibilitySummary(compatibility)).toBe("model/list failed; Plan mode uses experimental collaborationMode override");
  });
});

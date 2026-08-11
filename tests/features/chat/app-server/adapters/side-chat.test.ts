import { describe, expect, it, vi } from "vitest";

import type { AppServerRequestClient } from "../../../../../src/app-server/services/request-client";
import { EphemeralThreadCleanupRequiredError, forkEphemeralThread } from "../../../../../src/features/chat/app-server/adapters/side-chat";

describe("side-chat app-server adapter", () => {
  it("forks read-only ephemeral threads behind a model-visible boundary", async () => {
    const client = {
      request: vi.fn((method: string) => {
        if (method === "config/read") return Promise.resolve({ config: { developer_instructions: "Existing policy." } });
        if (method === "thread/inject_items") return Promise.resolve({});
        return Promise.resolve(sideChatForkResponse());
      }),
    } as unknown as AppServerRequestClient;

    const result = await forkEphemeralThread(client, "source", "/vault");

    expect(client.request).toHaveBeenNthCalledWith(1, "config/read", { cwd: "/vault" });
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      "thread/fork",
      expect.objectContaining({
        threadId: "source",
        cwd: "/vault",
        ephemeral: true,
        sandbox: "read-only",
        approvalPolicy: "never",
        excludeTurns: true,
        developerInstructions: expect.stringContaining("Existing policy."),
      }),
    );
    expect(client.request).toHaveBeenNthCalledWith(3, "thread/inject_items", {
      threadId: "side",
      items: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: expect.stringContaining("Side conversation boundary.") }],
        },
      ],
    });
    expect(result).toMatchObject({ sourceThreadId: "source", activation: { thread: { id: "side" } } });
  });

  it("unsubscribes a fork when boundary injection fails", async () => {
    const injectionError = new Error("inject failed");
    const request = vi.fn((method: string) => {
      if (method === "config/read") return Promise.resolve({ config: { developer_instructions: null } });
      if (method === "thread/fork") return Promise.resolve(sideChatForkResponse());
      if (method === "thread/inject_items") return Promise.reject(injectionError);
      return Promise.resolve({ status: "unsubscribed" });
    });
    const client = { request } as unknown as AppServerRequestClient;

    await expect(forkEphemeralThread(client, "source", "/vault")).rejects.toBe(injectionError);

    expect(request).toHaveBeenLastCalledWith("thread/unsubscribe", { threadId: "side" }, { timeoutMs: 5_000 });
  });

  it("returns the fork id when boundary injection and cleanup both fail", async () => {
    const injectionError = new Error("inject failed");
    const cleanupError = new Error("unsubscribe failed");
    const request = vi.fn((method: string) => {
      if (method === "config/read") return Promise.resolve({ config: { developer_instructions: null } });
      if (method === "thread/fork") return Promise.resolve(sideChatForkResponse());
      if (method === "thread/inject_items") return Promise.reject(injectionError);
      return Promise.reject(cleanupError);
    });
    const client = { request } as unknown as AppServerRequestClient;

    const error = await forkEphemeralThread(client, "source", "/vault").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(EphemeralThreadCleanupRequiredError);
    expect(error).toMatchObject({ threadId: "side", cause: injectionError, cleanupError });
  });
});

function sideChatForkResponse() {
  return {
    thread: { id: "side", preview: "", name: null, createdAt: 1, updatedAt: 1 },
    cwd: "/vault",
    model: "gpt-5.5",
    serviceTier: null,
    approvalsReviewer: null,
    reasoningEffort: null,
    approvalPolicy: "never",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: null,
  };
}

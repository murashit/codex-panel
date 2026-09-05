import { describe, expect, it, vi } from "vitest";

import { recoverRolloutTokenUsage } from "../../../../../src/features/chat/app-server/mappers/rollout-token-usage";

describe("rollout token usage recovery", () => {
  it("parses the last valid token_count event", async () => {
    const first = tokenCountLine({ input: 100, total: 120, context: 1000 });
    const second = tokenCountLine({ input: 250, total: 300, context: 2000 });

    const readFileBase64 = vi
      .fn()
      .mockResolvedValue(btoa(["not json", first, '{"type":"response_item","payload":{}}', second, ""].join("\n")));

    await expect(recoverRolloutTokenUsage("/tmp/rollout.jsonl", readFileBase64)).resolves.toEqual({
      last: {
        inputTokens: 250,
        cachedInputTokens: 25,
        outputTokens: 10,
        reasoningOutputTokens: 5,
        totalTokens: 300,
      },
      total: {
        inputTokens: 500,
        cachedInputTokens: 50,
        outputTokens: 20,
        reasoningOutputTokens: 10,
        totalTokens: 600,
      },
      modelContextWindow: 2000,
    });
    expect(readFileBase64).toHaveBeenCalledWith("/tmp/rollout.jsonl", { timeoutMs: 2_000 });
  });

  it("recovers a zero-usage record with an unknown context window from a Windows rollout path", async () => {
    const usage = { total_tokens: 0, input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
    const line = JSON.stringify({
      type: "event_msg",
      payload: { type: "token_count", info: { last_token_usage: usage, total_token_usage: usage, model_context_window: null } },
    });
    const readFileBase64 = vi.fn().mockResolvedValue(btoa(line));

    await expect(recoverRolloutTokenUsage("C:\\Codex\\rollout.jsonl", readFileBase64)).resolves.toEqual({
      last: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      total: { totalTokens: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0 },
      modelContextWindow: null,
    });
  });

  it("keeps the last usable event when later records contain invalid usage or partial JSON", async () => {
    const valid = tokenCountLine({ input: 42, total: 50, context: 1000 });
    const invalid = tokenCountLine({ input: -1, total: 60, context: 1000 });
    const readFileBase64 = vi.fn().mockResolvedValue(btoa([valid, invalid, '{"type":'].join("\n")));

    await expect(recoverRolloutTokenUsage("/tmp/rollout.jsonl", readFileBase64)).resolves.toMatchObject({
      last: { inputTokens: 42, totalTokens: 50 },
      total: { inputTokens: 84, totalTokens: 100 },
    });
  });

  it("returns null for missing or invalid token usage shapes", async () => {
    const invalidShape = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: { input_tokens: -1 },
          total_token_usage: {},
          model_context_window: 1000,
        },
      },
    });

    await expect(recoverRolloutTokenUsage("/tmp/empty.jsonl", vi.fn().mockResolvedValue(btoa("")))).resolves.toBeNull();
    await expect(
      recoverRolloutTokenUsage(
        "/tmp/message.jsonl",
        vi.fn().mockResolvedValue(btoa('{"type":"event_msg","payload":{"type":"agent_message"}}')),
      ),
    ).resolves.toBeNull();
    await expect(recoverRolloutTokenUsage("/tmp/invalid.jsonl", vi.fn().mockResolvedValue(btoa(invalidShape)))).resolves.toBeNull();
  });

  it("skips relative paths, read failures, invalid base64, and oversized payloads", async () => {
    const readFileBase64 = vi.fn().mockResolvedValue(btoa(tokenCountLine({ input: 42, total: 50, context: 1000 })));
    await expect(recoverRolloutTokenUsage("relative.jsonl", readFileBase64)).resolves.toBeNull();
    expect(readFileBase64).not.toHaveBeenCalled();

    await expect(recoverRolloutTokenUsage("/tmp/rollout.jsonl", vi.fn().mockRejectedValue(new Error("missing")))).resolves.toBeNull();
    await expect(recoverRolloutTokenUsage("/tmp/rollout.jsonl", vi.fn().mockResolvedValue("%%%"))).resolves.toBeNull();
    await expect(
      recoverRolloutTokenUsage("/tmp/rollout.jsonl", vi.fn().mockResolvedValue("a".repeat(12 * 1024 * 1024 + 1))),
    ).resolves.toBeNull();
  });
});

function tokenCountLine(options: { input: number; total: number; context: number }): string {
  return JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: options.input,
          cached_input_tokens: 25,
          output_tokens: 10,
          reasoning_output_tokens: 5,
          total_tokens: options.total,
        },
        total_token_usage: {
          input_tokens: options.input * 2,
          cached_input_tokens: 50,
          output_tokens: 20,
          reasoning_output_tokens: 10,
          total_tokens: options.total * 2,
        },
        model_context_window: options.context,
      },
    },
  });
}

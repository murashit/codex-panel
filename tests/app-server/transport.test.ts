import { describe, expect, it, vi } from "vitest";

import { type AppServerTransportHandlers, StdioAppServerTransport } from "../../src/app-server/connection/transport";

interface TestableTransport {
  handleStderr(text: string): void;
  flushStderr(): void;
}

describe("StdioAppServerTransport", () => {
  it("emits complete stderr lines and flushes the final partial line", () => {
    const { onLog, transport } = transportFixture();

    transport.handleStderr("first line\npartial");

    expect(onLog).toHaveBeenCalledWith("first line");
    expect(onLog).not.toHaveBeenCalledWith("partial");

    transport.flushStderr();

    expect(onLog).toHaveBeenCalledWith("partial");
  });

  it("ignores whitespace-only stderr fragments when flushing", () => {
    const { onLog, transport } = transportFixture();

    transport.handleStderr("   ");
    transport.flushStderr();

    expect(onLog).not.toHaveBeenCalled();
  });
});

function transportFixture(): { onLog: ReturnType<typeof vi.fn>; transport: TestableTransport } {
  const onLog = vi.fn();
  const handlers: AppServerTransportHandlers = {
    onLine: vi.fn(),
    onLog,
    onExit: vi.fn(),
    onError: vi.fn(),
  };
  return {
    onLog,
    transport: new StdioAppServerTransport("codex", "/vault", handlers) as unknown as TestableTransport,
  };
}

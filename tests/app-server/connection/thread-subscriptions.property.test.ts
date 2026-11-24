import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { AppServerClient } from "../../../src/app-server/connection/client";
import { StaleConnectionError } from "../../../src/app-server/connection/connection-manager";
import { ThreadSubscriptions } from "../../../src/app-server/connection/thread-subscriptions";
import { type Deferred, deferred, eventOrders } from "../../support/async";

const thread = fc.constantFrom("a", "b");
const events = fc.array(
  fc.oneof(
    fc.record({
      kind: fc.constant("interest"),
      panel: fc.integer({ min: 0, max: 1 }),
      thread,
      mode: fc.constantFrom("none", "upstream", "resume"),
    }),
    fc.record({ kind: fc.constant("complete"), slot: fc.nat(9), success: fc.boolean() }),
    fc.record({ kind: fc.constant("activate"), thread: fc.option(thread, { nil: null }) }),
    fc.record({ kind: fc.constant("finish"), slot: fc.nat(9) }),
    fc.record({ kind: fc.constant("record"), thread, retired: fc.boolean() }),
    fc.record({ kind: fc.constant("reset") }),
    fc.record({ kind: fc.constant("reconcile") }),
  ),
  { maxLength: 60, size: "max" },
);

type Event = (typeof events extends fc.Arbitrary<infer Sequence> ? Sequence : never)[number];

interface PendingUpdate {
  epoch: number;
  threadId: string;
  method: string;
  reply: Deferred<unknown>;
  attached: Set<string>;
  settled: boolean;
}

interface Activation {
  epoch: number;
  threadId: string | null;
  gate: Deferred<void>;
  entered: boolean;
  finished: boolean;
  done: Promise<void>;
}

describe("sampled thread subscription interleavings", () => {
  it.each(eventOrders("release-first", "claim-second", "resume-reply"))(
    "converges when two panels hand off demand around a pending resume for $order",
    async ({ order }) => {
      const fixture = subscriptionInterleavings();
      try {
        await fixture.apply({ kind: "interest", panel: 0, thread: "a", mode: "resume" });
        for (const event of order) {
          if (event === "release-first") await fixture.apply({ kind: "interest", panel: 0, thread: "a", mode: "none" });
          if (event === "claim-second") await fixture.apply({ kind: "interest", panel: 1, thread: "a", mode: "resume" });
          if (event === "resume-reply") await fixture.apply({ kind: "complete", slot: 0, success: true });
        }
        await fixture.converge();
        const droppedBetweenOwners = order.at(-1) === "claim-second";
        expect(fixture.methods()).toEqual(
          droppedBetweenOwners ? ["thread/resume", "thread/unsubscribe", "thread/resume"] : ["thread/resume"],
        );
      } finally {
        await fixture.dispose();
      }
    },
  );

  it("preserves update exclusion, activation barriers and connection isolation, then converges after successful replies", async () => {
    await expect(
      fc.assert(
        fc.asyncProperty(events, async (sequence) => {
          const fixture = subscriptionInterleavings();
          try {
            for (const event of sequence) await fixture.apply(event);
            await fixture.converge();
          } finally {
            await fixture.dispose();
          }
        }),
        { numRuns: 200 },
      ),
    ).resolves.toBeUndefined();
  });
});

function subscriptionInterleavings() {
  let epoch = 0;
  const panels = [new Map<string, boolean>(), new Map<string, boolean>()];
  const updates: PendingUpdate[] = [];
  const activations: Activation[] = [];
  const violations: string[] = [];
  const failures: string[] = [];
  const clients: AppServerClient[] = [];
  let attached = new Set<string>();
  const required = () => panels.flatMap((panel) => [...panel].map(([threadId, canResume]) => ({ threadId, canResume })));
  const activeScopes = () => activations.filter((activation) => activation.epoch === epoch && !activation.finished);

  function createClient(): AppServerClient {
    const clientEpoch = epoch;
    const clientAttached = attached;
    // Only the transport boundary is doubled. Replies stay pending until a generated
    // event selects one, including replies from clients retired by a reset.
    const client = {
      request: (method: string, { threadId }: { threadId: string }) => {
        if (clientEpoch !== epoch) violations.push("retired client issued an update");
        if (updates.some((update) => update.epoch === clientEpoch && update.threadId === threadId && !update.settled)) {
          violations.push("overlapping updates for one client and thread");
        }
        const scopes = activeScopes();
        if (scopes.some((scope) => scope.threadId === threadId)) violations.push("update during same-thread activation");
        if (method === "thread/unsubscribe") {
          if (scopes.some((scope) => scope.threadId === null)) violations.push("release during creation");
          if (required().some((interest) => interest.threadId === threadId)) violations.push("release despite current demand");
        } else if (!required().some((interest) => interest.threadId === threadId && interest.canResume)) {
          violations.push("resume without resumable demand");
        }
        const reply = deferred<unknown>();
        updates.push({ epoch: clientEpoch, threadId, method, reply, attached: clientAttached, settled: false });
        return reply.promise;
      },
    } as unknown as AppServerClient;
    clients.push(client);
    return client;
  }

  let client = createClient();
  const subscriptions = new ThreadSubscriptions(
    () => client,
    required,
    (message) => failures.push(message),
  );
  const waitForNextEventLoopTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
  const check = () => expect(violations).toEqual([]);

  async function complete(update: PendingUpdate, success: boolean): Promise<void> {
    update.settled = true;
    const failuresBefore = failures.length;
    if (success) {
      if (update.method === "thread/resume") update.attached.add(update.threadId);
      else update.attached.delete(update.threadId);
      update.reply.resolve({});
    } else update.reply.reject(new Error("generated transport failure"));
    await waitForNextEventLoopTurn();
    expect(failures).toHaveLength(failuresBefore + (!success && update.epoch === epoch ? 1 : 0));
    check();
  }

  function beginActivation(threadId: string | null): void {
    const activation: Activation = { epoch, threadId, gate: deferred<void>(), entered: false, finished: false, done: Promise.resolve() };
    activations.push(activation);
    activation.done = subscriptions
      .activate(threadId, () => {
        activation.entered = true;
        if (activation.epoch !== epoch) violations.push("retired activation entered its callback");
        if (updates.some((update) => update.epoch === epoch && update.threadId === threadId && !update.settled)) {
          violations.push("activation overtook a preceding update");
        }
        return activation.gate.promise;
      })
      .then(
        () => {
          activation.finished = true;
          if (!activation.entered) violations.push("activation succeeded without running its operation");
        },
        (error: unknown) => {
          activation.finished = true;
          if (!(error instanceof StaleConnectionError) || activation.epoch === epoch) violations.push("unexpected activation failure");
        },
      );
  }

  function finish(activation: Activation): void {
    activation.finished = true;
    activation.gate.resolve();
  }

  return {
    methods: () => updates.map(({ method }) => method),
    async apply(event: Event): Promise<void> {
      switch (event.kind) {
        case "interest": {
          const panel = panels[event.panel];
          if (!panel) throw new Error("Unknown panel");
          if (event.mode === "none") panel.delete(event.thread);
          else panel.set(event.thread, event.mode === "resume");
          subscriptions.reconcile();
          break;
        }
        case "complete": {
          const pending = updates.filter((update) => !update.settled);
          const update = pending[event.slot % pending.length];
          if (update) await complete(update, event.success);
          break;
        }
        case "activate":
          beginActivation(event.thread);
          break;
        case "finish": {
          const pending = activations.filter((activation) => !activation.finished);
          const activation = pending[event.slot % pending.length];
          if (activation) finish(activation);
          break;
        }
        case "record": {
          const source = event.retired ? clients.at(-2) : client;
          if (source) {
            // Reconcile first so a legitimate retry cannot be mistaken for work
            // introduced by an attachment from a retired client.
            subscriptions.reconcile();
            const count = updates.length;
            if (source === client) attached.add(event.thread);
            subscriptions.record(event.thread, source);
            subscriptions.reconcile();
            if (source !== client) expect(updates).toHaveLength(count);
          }
          break;
        }
        case "reset":
          subscriptions.reset();
          epoch += 1;
          attached = new Set();
          for (const panel of panels) panel.clear();
          client = createClient();
          break;
        case "reconcile":
          subscriptions.reconcile();
          break;
      }
      await waitForNextEventLoopTurn();
      check();
    },
    async converge(): Promise<void> {
      for (const activation of activations) finish(activation);
      await waitForNextEventLoopTurn();
      // Stabilize demand, explicitly retry failures, and supply successful replies.
      // This tests conditional convergence, not liveness under arbitrary failures.
      const budget = updates.length + activations.length + 10;
      for (let attempt = 0; attempt < budget; attempt += 1) {
        subscriptions.reconcile();
        const pending = updates.find((update) => !update.settled);
        if (!pending) break;
        await complete(pending, true);
      }
      expect(updates.every((update) => update.settled)).toBe(true);
      await Promise.all(activations.map((activation) => activation.done));
      for (const threadId of ["a", "b"]) {
        const interests = required().filter((interest) => interest.threadId === threadId);
        if (interests.some((interest) => interest.canResume)) expect(attached.has(threadId)).toBe(true);
        if (interests.length === 0) expect(attached.has(threadId)).toBe(false);
      }
      const count = updates.length;
      subscriptions.reconcile();
      await waitForNextEventLoopTurn();
      expect(updates).toHaveLength(count);
      check();
    },
    async dispose(): Promise<void> {
      subscriptions.reset();
      epoch += 1;
      for (const activation of activations) finish(activation);
      for (const update of updates) if (!update.settled) update.reply.resolve({});
      await Promise.all(activations.map((activation) => activation.done));
      await waitForNextEventLoopTurn();
    },
  };
}

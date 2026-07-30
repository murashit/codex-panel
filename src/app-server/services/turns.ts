import type { CodexInput } from "../../domain/chat/input";
import type { ClientResponseByMethod } from "../connection/client";
import type { ClientRequestParams } from "../connection/rpc-messages";
import { appServerTurnInputFromCodexInput, toAppServerUserInput } from "../protocol/request-input";
import type { AppServerRequestClient } from "./request-client";

type AppServerTurnRuntimeOverrides = Partial<AppServerTurnRuntimeParams>;

type AppServerTurnRuntimeParams = Pick<
  ClientRequestParams<"turn/start">,
  "serviceTier" | "collaborationMode" | "model" | "effort" | "approvalsReviewer"
>;

export interface AppServerStartTurnOptions {
  threadId: string;
  cwd: string;
  input: string | CodexInput;
  clientUserMessageId?: string | null;
  runtime?: AppServerTurnRuntimeOverrides;
}

export interface AppServerStartStructuredTurnOptions {
  threadId: string;
  cwd: string;
  text: string;
  outputSchema: NonNullable<ClientRequestParams<"turn/start">["outputSchema"]>;
  runtime?: AppServerTurnRuntimeOverrides;
}

export type AppServerSteerDispatch =
  | { readonly kind: "dispatched"; readonly completion: Promise<unknown> }
  | { readonly kind: "not-dispatched"; readonly error: unknown };

export function startTurn(
  client: AppServerRequestClient,
  options: AppServerStartTurnOptions,
): Promise<ClientResponseByMethod["turn/start"]> {
  const { threadId, cwd, input, clientUserMessageId, runtime } = options;
  const prepared = toTurnInput(input, contextSubmissionId(clientUserMessageId, "user"));
  const params: ClientRequestParams<"turn/start"> = {
    threadId,
    cwd,
    ...(clientUserMessageId !== undefined ? { clientUserMessageId } : {}),
    ...(prepared.additionalContext !== undefined ? { additionalContext: prepared.additionalContext } : {}),
    ...appServerTurnRuntimeParams(runtime),
    input: prepared.input,
  };
  return client.request("turn/start", params);
}

export function startStructuredTurn(
  client: AppServerRequestClient,
  options: AppServerStartStructuredTurnOptions,
): Promise<ClientResponseByMethod["turn/start"]> {
  const { threadId, cwd, text, outputSchema, runtime } = options;
  const params: ClientRequestParams<"turn/start"> = {
    threadId,
    cwd,
    input: [
      {
        type: "text",
        text,
        text_elements: [],
      },
    ],
    outputSchema,
    ...appServerTurnRuntimeParams(runtime),
  };
  return client.request("turn/start", params);
}

export function steerTurn(
  client: AppServerRequestClient,
  threadId: string,
  expectedTurnId: string,
  input: string | CodexInput,
  clientUserMessageId?: string | null,
): AppServerSteerDispatch {
  try {
    const prepared = toTurnInput(input, contextSubmissionId(clientUserMessageId, "steer"));
    return {
      kind: "dispatched",
      completion: client.request("turn/steer", {
        threadId,
        expectedTurnId,
        input: prepared.input,
        ...(clientUserMessageId !== undefined ? { clientUserMessageId } : {}),
        ...(prepared.additionalContext !== undefined ? { additionalContext: prepared.additionalContext } : {}),
      }),
    };
  } catch (error) {
    return { kind: "not-dispatched", error };
  }
}

export function interruptTurn(client: AppServerRequestClient, threadId: string, turnId: string): Promise<unknown> {
  return client.request("turn/interrupt", { threadId, turnId });
}

function toTurnInput(input: string | CodexInput, submissionId: string) {
  if (typeof input !== "string") return appServerTurnInputFromCodexInput(input, submissionId);
  return { input: toAppServerUserInput([{ type: "text", text: input }]) };
}

function appServerTurnRuntimeParams(runtime: AppServerTurnRuntimeOverrides | undefined): AppServerTurnRuntimeParams {
  const params: AppServerTurnRuntimeParams = {};
  if (runtime?.serviceTier !== undefined) params.serviceTier = runtime.serviceTier;
  if (runtime?.collaborationMode !== undefined) params.collaborationMode = runtime.collaborationMode;
  if (runtime?.model !== undefined) params.model = runtime.model;
  if (runtime?.effort !== undefined) params.effort = runtime.effort;
  if (runtime?.approvalsReviewer !== undefined) params.approvalsReviewer = runtime.approvalsReviewer;
  return params;
}

let fallbackContextSubmissionSequence = 0;

function contextSubmissionId(clientUserMessageId: string | null | undefined, kind: "user" | "steer"): string {
  if (clientUserMessageId) return clientUserMessageId;
  fallbackContextSubmissionSequence += 1;
  return `local-${kind}-${String(Date.now())}-fallback-${String(fallbackContextSubmissionSequence)}-1`;
}

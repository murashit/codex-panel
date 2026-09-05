import {
  type EphemeralStructuredTurnRunner,
  runEphemeralStructuredTurnForAssistantTranscriptText,
  type StructuredTurnOutputSchema,
} from "../../../app-server/services/ephemeral-structured-turn";
import type { ReasoningEffort } from "../../../domain/catalog/metadata";
import type { ThreadTitleContext } from "../../../domain/threads/title-context";

const THREAD_TITLE_MAX_CHARS = 40;

const THREAD_TITLE_SERVICE_NAME = "codex-panel-naming";
const THREAD_TITLE_TIMEOUT_MS = 60_000;

const TITLE_OUTPUT_SCHEMA: StructuredTurnOutputSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      minLength: 1,
      maxLength: THREAD_TITLE_MAX_CHARS,
    },
  },
  required: ["title"],
  additionalProperties: false,
};

const TITLE_DEVELOPER_INSTRUCTIONS = [
  "You generate short titles for Codex thread history.",
  "Infer the main language of the user's initial request and write the title in that language.",
  "Return only a JSON object matching the requested schema.",
  "Do not include Markdown, quotes around the whole response, explanations, or alternatives.",
].join("\n");

export interface ThreadTitleRuntimeSettings {
  threadNamingModel: string | null;
  threadNamingEffort: ReasoningEffort | null;
}

export interface GenerateThreadTitleWithCodexOptions {
  runner?: EphemeralStructuredTurnRunner;
  signal?: AbortSignal;
}

export async function generateThreadTitleWithCodex(
  codexPath: string,
  cwd: string,
  context: ThreadTitleContext,
  runtimeSettings: ThreadTitleRuntimeSettings,
  options: GenerateThreadTitleWithCodexOptions = {},
): Promise<string | null> {
  const response = await runEphemeralStructuredTurnForAssistantTranscriptText(
    {
      codexPath,
      cwd,
      serviceName: THREAD_TITLE_SERVICE_NAME,
      developerInstructions: TITLE_DEVELOPER_INSTRUCTIONS,
      prompt: threadTitlePrompt(context),
      outputSchema: TITLE_OUTPUT_SCHEMA,
      timeoutMs: THREAD_TITLE_TIMEOUT_MS,
      serverRequests: { kind: "reject", message: "Thread title generation does not handle server requests." },
      exitedMessage: "Codex title generation app-server exited.",
      timedOutMessage: "Timed out while generating a Codex thread title.",
      abortMessage: "Thread title generation cancelled.",
      runtimeSettings: { model: runtimeSettings.threadNamingModel, effort: runtimeSettings.threadNamingEffort },
      signal: options.signal,
    },
    options.runner,
  );
  return response ? threadTitleFromGeneratedText(response) : null;
}

function normalizeGeneratedThreadTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value
    .trim()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^["'`「『]+/, "")
    .replace(/["'`」』]+$/, "")
    .trim();
  if (!title) return null;
  return title.length > THREAD_TITLE_MAX_CHARS ? title.slice(0, THREAD_TITLE_MAX_CHARS).trimEnd() : title;
}

function threadTitleFromGeneratedText(text: string): string | null {
  return normalizeGeneratedThreadTitle(extractTitleFromModelText(text));
}

function threadTitlePrompt(context: ThreadTitleContext): string {
  return [
    "Create a thread title for the following Codex thread.",
    "",
    "Requirements:",
    "- First infer the main language of the user's initial request. This does not need to be strict; use the dominant language if mixed.",
    "- Write the title in the inferred language. If the language is unclear, use the language used most in the user's initial request.",
    "- Use a short noun phrase or short sentence.",
    `- Keep it compact: roughly 3-7 words for languages that use spaces, or 12-28 characters for languages that usually do not. Never exceed ${String(THREAD_TITLE_MAX_CHARS)} characters.`,
    "- Make the request target and purpose clear.",
    "- Avoid vague titles such as only 'about this', 'general question', or 'please implement'.",
    "- Do not use Markdown, quotation marks, trailing punctuation, explanations, or alternatives.",
    "",
    "User's initial request:",
    context.userRequest,
    "",
    "Codex's first response:",
    context.assistantResponse,
  ].join("\n");
}

function extractTitleFromModelText(text: string): unknown {
  const trimmed = stripCodeFence(text.trim());
  const objectText = extractJsonObject(trimmed) ?? trimmed;
  try {
    const parsed = JSON.parse(objectText) as unknown;
    if (parsed && typeof parsed === "object" && "title" in parsed) {
      return (parsed as { title?: unknown }).title;
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

function stripCodeFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

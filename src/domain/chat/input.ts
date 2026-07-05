export interface RequestMention {
  name: string;
  path: string;
}

export const ACTIVE_FILE_MENTION_NAME = "<active>";

export interface RequestAdditionalContext {
  key: string;
  value: string;
  kind: "untrusted" | "application";
}

export type CodexInputItem =
  | { type: "text"; text: string }
  | { type: "image"; url: string; detail?: UserInputImageDetail }
  | { type: "localImage"; path: string; detail?: UserInputImageDetail }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string }
  | { type: "additionalContext"; key: string; value: string; kind: RequestAdditionalContext["kind"] };

export type CodexInput = CodexInputItem[];
type UserInputImageDetail = "auto" | "low" | "high" | "original";

export function codexTextInput(text: string): CodexInput {
  return [{ type: "text", text }];
}

export function codexTextInputWithMentions(
  text: string,
  mentions: readonly RequestMention[],
  skills: readonly RequestMention[] = [],
  additionalContext: readonly RequestAdditionalContext[] = [],
): CodexInput {
  return [
    ...codexTextInput(text),
    ...mentions.map((mention) => ({ type: "mention" as const, name: mention.name, path: mention.path })),
    ...skills.map((skill) => ({ type: "skill" as const, name: skill.name, path: skill.path })),
    ...additionalContext.map((context) => ({
      type: "additionalContext" as const,
      key: context.key,
      value: context.value,
      kind: context.kind,
    })),
  ];
}

export function codexTextInputWithAttachments(text: string, input: readonly CodexInputItem[]): CodexInput {
  return [...codexTextInput(text), ...input.filter((item) => item.type !== "text")];
}

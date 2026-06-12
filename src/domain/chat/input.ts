export interface RequestMention {
  name: string;
  path: string;
}

export type CodexInputItem =
  | { type: "text"; text: string }
  | { type: "image"; url: string; detail?: UserInputImageDetail }
  | { type: "localImage"; path: string; detail?: UserInputImageDetail }
  | { type: "skill"; name: string; path: string }
  | { type: "mention"; name: string; path: string };

export type CodexInput = CodexInputItem[];
type UserInputImageDetail = "auto" | "low" | "high" | "original";

export function codexTextInputWithMentions(
  text: string,
  mentions: readonly RequestMention[],
  skills: readonly RequestMention[] = [],
): CodexInput {
  return [
    ...codexTextInput(text),
    ...mentions.map((mention) => ({ type: "mention" as const, name: mention.name, path: mention.path })),
    ...skills.map((skill) => ({ type: "skill" as const, name: skill.name, path: skill.path })),
  ];
}

export function codexTextInputWithAttachments(text: string, input: readonly CodexInputItem[]): CodexInput {
  return [...codexTextInput(text), ...input.filter((item) => item.type !== "text")];
}

function codexTextInput(text: string): CodexInput {
  return [{ type: "text", text }];
}

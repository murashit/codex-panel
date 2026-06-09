import type { UserInput } from "../generated/app-server/v2/UserInput";

export interface AppServerRequestMention {
  name: string;
  path: string;
}

export function appServerTextInputWithMentions(
  text: string,
  mentions: readonly AppServerRequestMention[],
  skills: readonly AppServerRequestMention[] = [],
): UserInput[] {
  return [
    ...appServerTextInput(text),
    ...mentions.map((mention) => ({ type: "mention" as const, name: mention.name, path: mention.path })),
    ...skills.map((skill) => ({ type: "skill" as const, name: skill.name, path: skill.path })),
  ];
}

export function appServerTextInputWithAttachments(text: string, input: readonly UserInput[]): UserInput[] {
  return [...appServerTextInput(text), ...input.filter((item) => item.type !== "text")];
}

function appServerTextInput(text: string): UserInput[] {
  return [{ type: "text", text, text_elements: [] }];
}

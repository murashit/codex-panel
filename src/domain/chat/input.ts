export interface VaultFileReference {
  name: string;
  path: string;
}

export interface SkillReference {
  name: string;
  path: string;
}

export const ACTIVE_FILE_REFERENCE_NAME = "<active>";

export interface RequestAdditionalContext {
  key: string;
  value: string;
  kind: "untrusted" | "application";
  attachment?: TurnContextAttachment;
}

export type CodexInputItem =
  | { type: "text"; text: string }
  | { type: "image"; url: string; detail?: UserInputImageDetail }
  | { type: "localImage"; path: string; detail?: UserInputImageDetail }
  | { type: "skill"; name: string; path: string }
  | { type: "fileReference"; name: string; path: string }
  | {
      type: "additionalContext";
      key: string;
      value: string;
      kind: RequestAdditionalContext["kind"];
      attachment?: TurnContextAttachment;
    };

export type CodexInput = CodexInputItem[];
type UserInputImageDetail = "auto" | "low" | "high" | "original";

export function codexTextInput(text: string): CodexInput {
  return [{ type: "text", text }];
}

export function codexTextInputWithReferences(
  text: string,
  fileReferences: readonly VaultFileReference[],
  skills: readonly SkillReference[] = [],
  additionalContext: readonly RequestAdditionalContext[] = [],
): CodexInput {
  return [
    ...codexTextInput(text),
    ...fileReferences.map((reference) => ({ type: "fileReference" as const, name: reference.name, path: reference.path })),
    ...skills.map((skill) => ({ type: "skill" as const, name: skill.name, path: skill.path })),
    ...additionalContext.map((context) => ({
      type: "additionalContext" as const,
      key: context.key,
      value: context.value,
      kind: context.kind,
      ...(context.attachment ? { attachment: context.attachment } : {}),
    })),
  ];
}

export function codexTextInputWithAttachments(text: string, input: readonly CodexInputItem[]): CodexInput {
  return [...codexTextInput(text), ...input.filter((item) => item.type !== "text")];
}

import type { TurnContextAttachment } from "./context-manifest";

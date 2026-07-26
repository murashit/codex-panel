import { isSlashCommandName, type SlashCommandName } from "./catalog";

export function parseSlashCommand(text: string): { command: SlashCommandName; args: string } | null {
  const match = /^\/([A-Za-z-]+)(?:\s+([\s\S]*))?$/.exec(text);
  if (!match) return null;
  const command = match[1];
  if (!command || !isSlashCommandName(command)) return null;
  return { command, args: match.at(2)?.trim() ?? "" };
}

export function parseWebCommandArgs(args: string): { url: string; message: string } | null {
  const match = /^(\S+)(?:\s+([\s\S]*\S))?\s*$/.exec(args);
  if (!match) return null;
  const url = match[1];
  const message = match[2] ?? "";
  return url !== undefined ? { url, message } : null;
}

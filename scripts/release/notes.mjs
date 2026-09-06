import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import conventionalCommits from "conventional-changelog-conventionalcommits";
import { CommitParser } from "conventional-commits-parser";

const releaseNoteTypes = new Set(["feat", "fix", "perf"]);
const parser = new CommitParser(conventionalCommits().parser);

function fail(message) {
  throw new Error(`release notes generation failed: ${message}`);
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    shell: false,
  });
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    fail(`${args.join(" ")} exited with ${result.status}: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function formatSubject(subject) {
  const sentence = subject.replace(/^([a-z])/, (letter) => letter.toUpperCase());
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function releaseNoteForCommit(message) {
  const commit = parser.parse(message);
  if (!commit.subject) return null;

  const isBreaking = commit.notes.length > 0;
  if (!isBreaking && !releaseNoteTypes.has(commit.type ?? "")) return null;

  return formatSubject(commit.subject);
}

function renderReleaseNotes(messages) {
  const entries = messages.map(releaseNoteForCommit).filter((entry) => entry !== null);
  const bullets = entries.length > 0 ? entries.map((entry) => `- ${entry}`).join("\n") : "- ";
  return `## Changes\n\n${bullets}\n`;
}

function readCommitMessagesSince(tag, cwd = process.cwd()) {
  runGit(["rev-parse", "--verify", `refs/tags/${tag}`], cwd);
  const output = runGit(["log", "--format=%B%x00", `${tag}..HEAD`], cwd);
  return output
    .split("\0")
    .map((message) => message.trim())
    .filter(Boolean);
}

export function generateReleaseNotes(tag, cwd = process.cwd()) {
  return renderReleaseNotes(readCommitMessagesSince(tag, cwd));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const previousTag = process.argv[2];
  if (!previousTag) {
    console.error("usage: npm run release:notes -- <previous-tag>");
    process.exit(1);
  }

  try {
    process.stdout.write(generateReleaseNotes(previousTag));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

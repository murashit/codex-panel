import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { compareVersions, compatibilityBoundaryIsRecorded, parseVersion } from "./versioning.mjs";

function fail(message) {
  console.error(`release check failed: ${message}`);
  process.exitCode = 1;
}

function runGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) fail(`git ${args.join(" ")} failed`);
  return result.stdout.trim();
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLockJson = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifestJson = JSON.parse(await readFile("manifest.json", "utf8"));
const versionsJson = JSON.parse(await readFile("versions.json", "utf8"));

const releaseVersion = process.env.RELEASE_VERSION || packageJson.version;
const currentVersion = parseVersion(releaseVersion);

if (!currentVersion) fail(`release version must be X.Y.Z, got ${releaseVersion}`);
if (packageJson.version !== releaseVersion) fail(`package.json version ${packageJson.version} does not match ${releaseVersion}`);
if (packageLockJson.version !== releaseVersion) {
  fail(`package-lock.json version ${packageLockJson.version} does not match ${releaseVersion}`);
}
if (packageLockJson.packages?.[""]?.version !== releaseVersion) {
  fail(`package-lock root package version ${packageLockJson.packages?.[""]?.version} does not match ${releaseVersion}`);
}
if (manifestJson.version !== releaseVersion) fail(`manifest.json version ${manifestJson.version} does not match ${releaseVersion}`);
const versionKeys = Object.keys(versionsJson);
for (const versionKey of versionKeys) {
  const version = parseVersion(versionKey);
  if (!version) {
    fail(`versions.json contains invalid version ${versionKey}`);
  } else if (currentVersion && compareVersions(version, currentVersion) > 0) {
    fail(`versions.json entry ${versionKey} is newer than release ${releaseVersion}`);
  }
}

if (process.env.RELEASE_VERSION) {
  const previousTag = process.env.PREVIOUS_RELEASE_TAG || runGit(["describe", "--tags", "--abbrev=0", `${releaseVersion}^`]);
  const previousManifest = JSON.parse(runGit(["show", `${previousTag}:manifest.json`]));
  if (!compatibilityBoundaryIsRecorded(versionsJson, previousTag, previousManifest.minAppVersion, manifestJson.minAppVersion)) {
    fail(`versions.json must map the last compatible release ${previousTag} to ${previousManifest.minAppVersion}`);
  }
}

const notesPath = path.join(".github", "release-notes", `${releaseVersion}.md`);
let notes;
try {
  notes = await readFile(notesPath, "utf8");
} catch {
  fail(`release notes file is required at ${notesPath}`);
}

if (notes !== undefined) {
  const normalizedNotes = notes.replace(/\r\n/g, "\n");
  const changesHeading = normalizedNotes.match(/^## Changes\n\n/m);
  if (!changesHeading) {
    fail(`${notesPath} must contain "## Changes" followed by a blank line`);
  }
  const changesBody = normalizedNotes.slice((changesHeading.index ?? 0) + changesHeading[0].length);
  if (!/^-\s+\S/m.test(changesBody)) {
    fail(`${notesPath} must contain at least one bullet under Changes`);
  }
  const headings = [...normalizedNotes.matchAll(/^##\s+(.+)$/gm)];
  if (headings.length !== 1 || headings[0]?.[1] !== "Changes") {
    fail(`${notesPath} must contain a single Changes section`);
  }
}

if (process.exitCode) process.exit();

console.log(`release check passed for ${releaseVersion}`);

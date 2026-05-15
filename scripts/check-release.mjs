import { readFile } from "node:fs/promises";
import path from "node:path";
import { compareVersions, isExpectedNextVersion, parseVersion, readJson } from "./release-utils.mjs";

function fail(message) {
  console.error(`release check failed: ${message}`);
  process.exitCode = 1;
}

const packageJson = await readJson("package.json");
const packageLockJson = await readJson("package-lock.json");
const manifestJson = await readJson("manifest.json");
const versionsJson = await readJson("versions.json");

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
if (versionsJson[releaseVersion] !== manifestJson.minAppVersion) {
  fail(`versions.json must map ${releaseVersion} to manifest minAppVersion ${manifestJson.minAppVersion}`);
}

const versionKeys = Object.keys(versionsJson);
const latestVersionKey = versionKeys.at(-1);
if (latestVersionKey !== releaseVersion) {
  fail(`versions.json latest entry must be ${releaseVersion}, got ${latestVersionKey}`);
}

if (versionKeys.length >= 2) {
  const previousVersionKey = versionKeys.at(-2);
  const previousVersion = parseVersion(previousVersionKey);
  if (!previousVersion) fail(`versions.json contains invalid version ${previousVersionKey}`);
  if (currentVersion && previousVersion) {
    if (compareVersions(previousVersion, currentVersion) >= 0) {
      fail(`release version ${releaseVersion} must be newer than ${previousVersionKey}`);
    } else if (!isExpectedNextVersion(previousVersion, currentVersion)) {
      fail(`release version ${releaseVersion} is not the expected next version after ${previousVersionKey}`);
    }
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
  if (!normalizedNotes.startsWith("## Changes\n\n")) {
    fail(`${notesPath} must start with "## Changes" followed by a blank line`);
  }
  if (!/^-\s+\S/m.test(normalizedNotes)) {
    fail(`${notesPath} must contain at least one bullet under Changes`);
  }
  const extraHeadings = [...normalizedNotes.matchAll(/^##\s+(.+)$/gm)].slice(1);
  if (extraHeadings.length > 0) {
    fail(`${notesPath} must only contain the Changes section`);
  }
}

if (process.exitCode) process.exit();

console.log(`release check passed for ${releaseVersion}`);

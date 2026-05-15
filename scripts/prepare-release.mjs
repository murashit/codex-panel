import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function fail(message) {
  console.error(`release prepare failed: ${message}`);
  process.exit(1);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersions(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

function isExpectedNextVersion(previous, current) {
  if (current.major === previous.major && current.minor === previous.minor) {
    return current.patch === previous.patch + 1;
  }
  if (current.major === previous.major && current.minor === previous.minor + 1) {
    return current.patch === 0;
  }
  if (current.major === previous.major + 1) {
    return current.minor === 0 && current.patch === 0;
  }
  return false;
}

const releaseVersion = process.argv[2];
if (!releaseVersion) fail("usage: npm run release:prepare -- X.Y.Z");

const currentVersion = parseVersion(releaseVersion);
if (!currentVersion) fail(`release version must be X.Y.Z, got ${releaseVersion}`);

const packageJson = await readJson("package.json");
const packageLockJson = await readJson("package-lock.json");
const manifestJson = await readJson("manifest.json");
const versionsJson = await readJson("versions.json");

const versionKeys = Object.keys(versionsJson);
const previousVersionKey = versionKeys.at(-1);
const previousVersion = parseVersion(previousVersionKey);
if (!previousVersion) fail(`versions.json contains invalid latest version ${previousVersionKey}`);
if (compareVersions(previousVersion, currentVersion) >= 0) {
  fail(`release version ${releaseVersion} must be newer than ${previousVersionKey}`);
}
if (!isExpectedNextVersion(previousVersion, currentVersion)) {
  fail(`release version ${releaseVersion} is not the expected next version after ${previousVersionKey}`);
}
if (versionsJson[releaseVersion] !== undefined) fail(`versions.json already contains ${releaseVersion}`);

packageJson.version = releaseVersion;
packageLockJson.version = releaseVersion;
if (!packageLockJson.packages?.[""]) fail('package-lock.json is missing packages[""]');
packageLockJson.packages[""].version = releaseVersion;
manifestJson.version = releaseVersion;
versionsJson[releaseVersion] = manifestJson.minAppVersion;

await writeJson("package.json", packageJson);
await writeJson("package-lock.json", packageLockJson);
await writeJson("manifest.json", manifestJson);
await writeJson("versions.json", versionsJson);

const notesDir = path.join(".github", "release-notes");
const notesPath = path.join(notesDir, `${releaseVersion}.md`);
await mkdir(notesDir, { recursive: true });
try {
  await readFile(notesPath, "utf8");
  fail(`${notesPath} already exists`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await writeFile(notesPath, "## Changes\n\n- \n");

console.log(`prepared release ${releaseVersion}`);
console.log(`edit ${notesPath}, then run npm run release:preflight after committing`);

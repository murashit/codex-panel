import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateReleaseNotes } from "./notes.mjs";
import { compareVersions, compatibilityBoundaryIsRecorded, isExpectedNextVersion, parseVersion } from "./versioning.mjs";

function fail(message) {
  console.error(`release prepare failed: ${message}`);
  process.exit(1);
}

function readTaggedManifest(version) {
  const result = spawnSync("git", ["show", `${version}:manifest.json`], { encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) fail(`could not read manifest.json from tag ${version}`);
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`tag ${version} contains invalid manifest.json`);
  }
}

const releaseVersion = process.argv[2];
if (!releaseVersion) fail("usage: npm run release:prepare -- X.Y.Z");

const currentVersion = parseVersion(releaseVersion);
if (!currentVersion) fail(`release version must be X.Y.Z, got ${releaseVersion}`);

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageLockJson = JSON.parse(await readFile("package-lock.json", "utf8"));
const manifestJson = JSON.parse(await readFile("manifest.json", "utf8"));
const versionsJson = JSON.parse(await readFile("versions.json", "utf8"));
const notesDir = path.join(".github", "release-notes");
const notesPath = path.join(notesDir, `${releaseVersion}.md`);

const previousVersionKey = packageJson.version;
const previousVersion = parseVersion(previousVersionKey);
if (!previousVersion) fail(`package.json version must be X.Y.Z, got ${previousVersionKey}`);
if (compareVersions(previousVersion, currentVersion) >= 0) {
  fail(`release version ${releaseVersion} must be newer than ${previousVersionKey}`);
}
if (!isExpectedNextVersion(previousVersion, currentVersion)) {
  fail(`release version ${releaseVersion} is not the expected next version after ${previousVersionKey}`);
}
const previousManifestJson = readTaggedManifest(previousVersionKey);
if (!compatibilityBoundaryIsRecorded(versionsJson, previousVersionKey, previousManifestJson.minAppVersion, manifestJson.minAppVersion)) {
  fail(
    `versions.json must map the last compatible release ${previousVersionKey} to ${previousManifestJson.minAppVersion} before raising minAppVersion`,
  );
}
try {
  await readFile(notesPath, "utf8");
  fail(`${notesPath} already exists`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

let releaseNotes;
try {
  releaseNotes = generateReleaseNotes(previousVersionKey);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

packageJson.version = releaseVersion;
packageLockJson.version = releaseVersion;
if (!packageLockJson.packages?.[""]) fail('package-lock.json is missing packages[""]');
packageLockJson.packages[""].version = releaseVersion;
manifestJson.version = releaseVersion;

await writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile("package-lock.json", `${JSON.stringify(packageLockJson, null, 2)}\n`);
await writeFile("manifest.json", `${JSON.stringify(manifestJson, null, 2)}\n`);
await mkdir(notesDir, { recursive: true });
await writeFile(notesPath, releaseNotes);

console.log(`prepared release ${releaseVersion}`);
console.log(`review and edit ${notesPath}, then run npm run release:preflight after committing`);

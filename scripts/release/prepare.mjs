import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareVersions, isExpectedNextVersion, parseVersion } from "./versioning.mjs";

function fail(message) {
  console.error(`release prepare failed: ${message}`);
  process.exit(1);
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
try {
  await readFile(notesPath, "utf8");
  fail(`${notesPath} already exists`);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

packageJson.version = releaseVersion;
packageLockJson.version = releaseVersion;
if (!packageLockJson.packages?.[""]) fail('package-lock.json is missing packages[""]');
packageLockJson.packages[""].version = releaseVersion;
manifestJson.version = releaseVersion;
versionsJson[releaseVersion] = manifestJson.minAppVersion;

await writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile("package-lock.json", `${JSON.stringify(packageLockJson, null, 2)}\n`);
await writeFile("manifest.json", `${JSON.stringify(manifestJson, null, 2)}\n`);
await writeFile("versions.json", `${JSON.stringify(versionsJson, null, 2)}\n`);

await mkdir(notesDir, { recursive: true });
await writeFile(notesPath, "## Changes\n\n- \n");

console.log(`prepared release ${releaseVersion}`);
console.log(`edit ${notesPath}, then run npm run release:preflight after committing`);

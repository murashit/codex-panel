import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareVersions, isExpectedNextVersion, parseVersion, readJson, writeJson } from "./utils.mjs";

function fail(message) {
  console.error(`release prepare failed: ${message}`);
  process.exit(1);
}

const releaseVersion = process.argv[2];
if (!releaseVersion) fail("usage: npm run release:prepare -- X.Y.Z");

const currentVersion = parseVersion(releaseVersion);
if (!currentVersion) fail(`release version must be X.Y.Z, got ${releaseVersion}`);

const packageJson = await readJson("package.json");
const packageLockJson = await readJson("package-lock.json");
const manifestJson = await readJson("manifest.json");
const versionsJson = await readJson("versions.json");
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

await writeJson("package.json", packageJson);
await writeJson("package-lock.json", packageLockJson);
await writeJson("manifest.json", manifestJson);
await writeJson("versions.json", versionsJson);

await mkdir(notesDir, { recursive: true });
await writeFile(notesPath, "## Changes\n\n- \n");

console.log(`prepared release ${releaseVersion}`);
console.log(`edit ${notesPath}, then run npm run release:preflight after committing`);

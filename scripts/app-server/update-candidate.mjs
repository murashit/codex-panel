import { readFile, writeFile } from "node:fs/promises";
import { compareVersions, parseVersion } from "../version.mjs";
import { readAppServerGenerationPolicy } from "./compatibility.mjs";

const [command, argument] = process.argv.slice(2);
const { testedCliVersion } = await readAppServerGenerationPolicy(process.cwd());
if (command === "select" && argument) {
  const pages = JSON.parse(await readFile(argument, "utf8"));
  const current = parseVersion(testedCliVersion);
  let latest = null;
  for (const release of pages.flat()) {
    if (release.isDraft || release.isPrerelease) continue;
    const version = parseVersion(/^rust-v(.+)$/.exec(release.tagName)?.[1]);
    if (version && (!latest || compareVersions(version, latest) > 0)) latest = version;
  }
  if (!latest) throw new Error("No stable Codex CLI release found");
  if (compareVersions(latest.slice(0, 2), current.slice(0, 2)) > 0) console.log(latest.join("."));
} else if (command === "update" && argument && parseVersion(argument)) {
  const file = "src/app-server/compatibility.json";
  const compatibility = await readFile(file, "utf8");
  const readme = await readFile("README.md", "utf8");
  const row = /(^\| `codexAppServer\.testedCliVersion`\s*\| `)([^`]+)(`\s*\|)/gm;
  const matches = [...readme.matchAll(row)];
  if (matches.length !== 1 || matches[0][2] !== testedCliVersion)
    throw new Error("README compatibility row is missing, ambiguous, or differs from the recorded version");
  const oldValue = `"testedCliVersion": "${testedCliVersion}"`;
  if (compatibility.split(oldValue).length !== 2) throw new Error("Compatibility version is missing or ambiguous");
  await writeFile(file, compatibility.replace(oldValue, `"testedCliVersion": "${argument}"`));
  await writeFile(
    "README.md",
    readme.replace(row, (_, prefix, _version, suffix) => `${prefix}${argument}${suffix}`),
  );
} else {
  throw new Error("Usage: node scripts/app-server/update-candidate.mjs select RELEASES_JSON | update X.Y.Z");
}

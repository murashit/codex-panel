import { readFile, writeFile } from "node:fs/promises";
import { readAppServerGenerationPolicy } from "./compatibility.mjs";

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const parse = (version) => {
  const match = versionPattern.exec(version);
  return match?.slice(1).map(BigInt);
};
const compare = (a, b) => {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
};

const [command, argument] = process.argv.slice(2);
const { testedCliVersion } = await readAppServerGenerationPolicy(process.cwd());
if (command === "select" && argument) {
  const pages = JSON.parse(await readFile(argument, "utf8"));
  const current = parse(testedCliVersion);
  const versions = pages
    .flat()
    .filter((release) => !release.isDraft && !release.isPrerelease)
    .map((release) => /^rust-v(.+)$/.exec(release.tagName)?.[1])
    .filter((version) => version && parse(version));
  versions.sort((a, b) => compare(parse(b), parse(a)));
  const latest = versions[0];
  if (!latest) throw new Error("No stable Codex CLI release found");
  if (compare(parse(latest).slice(0, 2), current.slice(0, 2)) > 0) console.log(latest);
} else if (command === "update" && argument && parse(argument)) {
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

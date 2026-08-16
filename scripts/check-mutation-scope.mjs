import { glob } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import strykerConfig from "../stryker.config.mjs";

export async function unmatchedMutationPatterns(patterns = strykerConfig.mutate, cwd = process.cwd()) {
  const unmatched = [];
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) continue;
    let matched = false;
    for await (const _file of glob(pattern, { cwd })) {
      matched = true;
      break;
    }
    if (!matched) unmatched.push(pattern);
  }
  return unmatched;
}

async function main() {
  const unmatched = await unmatchedMutationPatterns();
  if (unmatched.length === 0) return;
  console.error(`Mutation patterns matched no files:\n${unmatched.map((pattern) => `- ${pattern}`).join("\n")}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

import { glob } from "node:fs/promises";

import strykerConfig from "../stryker.config.mjs";

const unmatched = [];
for (const pattern of strykerConfig.mutate) {
  if (pattern.startsWith("!")) continue;
  let matched = false;
  for await (const _file of glob(pattern)) {
    matched = true;
    break;
  }
  if (!matched) unmatched.push(pattern);
}
if (unmatched.length > 0) {
  console.error(`Mutation patterns matched no files:\n${unmatched.map((pattern) => `- ${pattern}`).join("\n")}`);
  process.exitCode = 1;
}

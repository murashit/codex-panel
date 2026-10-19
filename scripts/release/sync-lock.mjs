import { readFile, writeFile } from "node:fs/promises";

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
if (!lock.packages?.[""]) throw new Error('package-lock.json is missing packages[""]');
lock.version = version;
lock.packages[""].version = version;
await writeFile("package-lock.json", `${JSON.stringify(lock, null, 2)}\n`);

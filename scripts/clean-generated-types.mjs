import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const generatedDir = path.resolve("src/generated/app-server");

await rm(generatedDir, { recursive: true, force: true });
await mkdir(generatedDir, { recursive: true });

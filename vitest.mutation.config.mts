import { mergeConfig } from "vitest/config";
import config from "./vitest.config.mts";

// Register mutation coverage hooks for each test file.
export default mergeConfig(config, { test: { isolate: true } });

import { mkdirSync } from "node:fs";
import { createApp } from "../dist/server/server/app.js";
import { loadServerEnv } from "../dist/server/server/env.js";
import { createLogger } from "../dist/server/server/logger.js";

if (process.env.VERCEL) {
  process.env.STORAGE_DIR = "/tmp/platform";
  process.env.PERSISTENCE_MODE = "file";
  try { mkdirSync("/tmp/platform", { recursive: true }); } catch {}
  process.env.NODE_ENV = "production";
}

const env = loadServerEnv();
const logger = createLogger(env);
const app = createApp({ env, logger });

export default app;

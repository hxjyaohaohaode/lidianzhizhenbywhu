import type { VercelRequest, VercelResponse } from "@vercel/node";
import { mkdirSync } from "node:fs";

process.env.STORAGE_DIR = "/tmp/platform";
process.env.PERSISTENCE_MODE = "file";
process.env.NODE_ENV = "production";
process.env.CORS_ORIGIN = "*";

try {
  mkdirSync("/tmp/platform", { recursive: true });
} catch {}

import { createApp } from "../dist/server/server/app.js";
import { loadServerEnv } from "../dist/server/server/env.js";
import { createLogger } from "../dist/server/server/logger.js";

const env = loadServerEnv();
const logger = createLogger(env);
const app = createApp({ env, logger });

export default function handler(req: VercelRequest, res: VercelResponse) {
  return app(req, res);
}

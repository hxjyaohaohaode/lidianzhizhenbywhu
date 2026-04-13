import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";

import { getServerEnv, type ServerEnv } from "../shared/config.js";

export function resolveEnvFilePath(
  cwd = process.cwd(),
  fileExists: (filePath: string) => boolean = existsSync,
) {
  const primaryPath = resolve(cwd, ".env");
  if (fileExists(primaryPath)) {
    return primaryPath;
  }

  const fallbackPath = resolve(cwd, ".env.example");
  if (fileExists(fallbackPath)) {
    return fallbackPath;
  }

  return primaryPath;
}

export function loadServerEnv(): ServerEnv {
  loadDotEnv({ path: resolveEnvFilePath() });
  return getServerEnv(process.env as Record<string, string | undefined>);
}

import pino, { type Logger } from "pino";

import { appMetadata, type ServerEnv } from "../shared/config.js";

export function createLogger(env: Pick<ServerEnv, "LOG_LEVEL" | "NODE_ENV">): Logger {
  return pino({
    name: appMetadata.service,
    level: env.LOG_LEVEL,
    base: {
      service: appMetadata.service,
      environment: env.NODE_ENV,
    },
    redact: {
      paths: ["req.headers.authorization", "req.headers.cookie"],
      remove: true,
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

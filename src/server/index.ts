import { createApp } from "./app.js";
import { loadServerEnv } from "./env.js";
import { createLogger } from "./logger.js";

const env = loadServerEnv();
const logger = createLogger(env);
const app = createApp({ env, logger });

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      apiBasePath: env.VITE_API_BASE_URL,
    },
    "api server started",
  );
});

const INDUSTRY_DATA_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const industryDataTimer = setInterval(() => {
  try {
    const appWithStore = app as unknown as { platformStore?: import("./platform-store.js").PlatformStore };
    if (appWithStore.platformStore) {
      const age = appWithStore.platformStore.getLatestIndustryDataAge();
      if (age === null || age > 10 * 60 * 1000) {
        logger.info({ ageMs: age }, "industry data stale, triggering refresh");
        appWithStore.platformStore.seedIndustryDataIfEmpty();
      }
    }
  } catch (error) {
    logger.error({ err: error }, "industry data refresh failed");
  }
}, INDUSTRY_DATA_REFRESH_INTERVAL_MS);

function gracefulShutdown(signal: string) {
  logger.info({ signal }, "received shutdown signal, flushing persisted data");
  const appWithStore = app as unknown as { platformStore?: import("./platform-store.js").PlatformStore };
  if (appWithStore.platformStore) {
    appWithStore.platformStore.destroy();
  }
  server.close(() => {
    logger.info("api server stopped");
    process.exit(0);
  });
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

process.on("unhandledRejection", (error) => {
  logger.error({ err: error }, "unhandled rejection");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "uncaught exception");
  process.exit(1);
});

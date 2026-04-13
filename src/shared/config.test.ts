import { describe, expect, it } from "vitest";

import {
  getClientEnv,
  getConfiguredProviders,
  getDeploymentReadiness,
  getRuntimeReadiness,
  getServerEnv,
} from "./config.js";

describe("shared config", () => {
  it("parses client environment with defaults", () => {
    const env = getClientEnv({});

    expect(env.VITE_APP_TITLE).toBe("锂电池企业智能诊断系统");
    expect(env.VITE_API_BASE_URL).toBe("/api");
  });

  it("redacts provider readiness into booleans", () => {
    const env = getServerEnv({
      DEEPSEEK_API_KEY: "deepseek",
      GLM_API_KEY: "",
      QWEN_API_KEY: "qwen",
    });

    expect(getConfiguredProviders(env)).toEqual({
      deepseekReasoner: true,
      glm5: false,
      qwen35Plus: true,
    });
    expect(env.PERSISTENCE_MODE).toBe("file");
    expect(env.CACHE_TTL_SECONDS).toBe(300);
    expect(env.RAG_SOURCE_WHITELIST).toContain("sse.com.cn");
  });

  it("ignores placeholder credentials from env examples", () => {
    const env = getServerEnv({
      DEEPSEEK_API_KEY: "your_deepseek_api_key",
      GLM_API_KEY: "example-glm-key",
      QWEN_API_KEY: "<QWEN_API_KEY>",
      NBS_TOKEN: "demo-nbs-token",
      NBS_ACCOUNT: "sample-account",
      NBS_PASSWORD: "replace_me",
    });

    expect(getConfiguredProviders(env)).toEqual({
      deepseekReasoner: false,
      glm5: false,
      qwen35Plus: false,
    });

    const readiness = getRuntimeReadiness(env);

    expect(readiness.canRunWithApiOnly).toBe(false);
    expect(readiness.subsystems.dataSources.nbsMode).toBe("public_fallback");
  });

  it("marks api-only runtime as ready while preserving optional data source degradation", () => {
    const env = getServerEnv({
      DEEPSEEK_API_KEY: "deepseek",
      QWEN_API_KEY: "qwen",
    });

    const readiness = getRuntimeReadiness(env);

    expect(readiness.canRunWithApiOnly).toBe(true);
    expect(readiness.runMode).toBe("api_only");
    expect(readiness.subsystems.dataSources.nbsMode).toBe("public_fallback");
    expect(readiness.warnings).toContain("未配置国家统计局凭证，宏观数据将降级为公开样例数据。");
  });

  it("treats NBS cookie as valid optional credential", () => {
    const env = getServerEnv({
      DEEPSEEK_API_KEY: "deepseek",
      NBS_COOKIE: "stats-token=valid-cookie",
    });

    const readiness = getRuntimeReadiness(env);

    expect(readiness.subsystems.dataSources.status).toBe("ready");
    expect(readiness.subsystems.dataSources.nbsMode).toBe("credential");
    expect(getDeploymentReadiness(env).optionalInputs[0]).toContain("NBS_COOKIE");
  });

  it("falls back to local mode when no llm api key is configured", () => {
    const env = getServerEnv({});

    const readiness = getRuntimeReadiness(env);

    expect(readiness.canRunWithApiOnly).toBe(false);
    expect(readiness.runMode).toBe("local_fallback");
    expect(readiness.subsystems.llm.status).toBe("degraded");
  });
});

import { z } from "zod";

import type { DeploymentReadiness, RuntimeReadiness } from "./types.js";

export const appMetadata = {
  name: "锂电池企业智能诊断系统",
  service: "battery-diagnostic-platform",
  version: "0.1.0",
} as const;

const optionalSecret = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }

  const compact = normalized.replace(/[\s"'`]+/g, "").toLowerCase();
  const placeholderPatterns = [
    /^your[_-]/,
    /^example([_-]|$)/,
    /^sample([_-]|$)/,
    /^demo([_-]|$)/,
    /^placeholder([_-]|$)/,
    /(^|[_-])token_here$/,
    /(^|[_-])api_key_here$/,
    /^replace_me$/,
    /^changeme$/,
    /^<[^>]+>$/,
    /^\[[^\]]+\]$/,
    /^\{[^}]+\}$/,
  ];
  const looksLikePlaceholder = placeholderPatterns.some((pattern) => pattern.test(compact));

  return looksLikePlaceholder ? undefined : normalized;
}, z.string().optional());

const booleanFlag = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}, z.boolean().default(false));

const csvValues = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}, z.array(z.string().min(1)).default([]));

export const clientEnvSchema = z.object({
  VITE_APP_TITLE: z.string().min(1).default(appMetadata.name),
  VITE_API_BASE_URL: z.string().min(1).default("/api"),
});

export const serverEnvSchema = clientEnvSchema.extend({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  CORS_ORIGIN: z.string().min(1).default("http://localhost:5173"),
  PERSISTENCE_MODE: z.enum(["memory", "file"]).default("file"),
  STORAGE_DIR: z.string().min(1).default(".runtime/platform"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  CACHE_STALE_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  ASYNC_TASK_CONCURRENCY: z.coerce.number().int().positive().default(2),
  AGENT_BUDGET_TOTAL_TOKENS: z.coerce.number().int().positive().default(16_000),
  AGENT_BUDGET_MAX_STEPS: z.coerce.number().int().positive().default(12),
  AGENT_RETRY_LIMIT: z.coerce.number().int().min(0).default(2),
  EXTERNAL_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(4_000),
  EXTERNAL_FETCH_RETRY_COUNT: z.coerce.number().int().min(0).default(2),
  RAG_SOURCE_WHITELIST: csvValues.default([
    "sse.com.cn",
    "szse.cn",
    "bse.cn",
    "cninfo.com.cn",
    "eastmoney.com",
    "dfcfw.com",
    "stats.gov.cn",
    "gov.cn",
    "edu.cn",
  ]),
  RAG_MAX_SOURCE_AGE_DAYS: z.coerce.number().int().positive().default(60),
  DATA_STALE_THRESHOLD_DAYS: z.coerce.number().int().positive().default(7),
  HEALTHCHECK_INCLUDE_DETAILS: booleanFlag.default(true),
  ENABLE_BACKGROUND_TASKS: booleanFlag.default(true),
  DEEPSEEK_API_KEY: optionalSecret,
  GLM_API_KEY: optionalSecret,
  QWEN_API_KEY: optionalSecret,
  DEEPSEEK_BASE_URL: z.string().optional().default("https://api.deepseek.com/v1"),
  GLM_BASE_URL: z.string().optional().default("https://open.bigmodel.cn/api/paas/v4"),
  QWEN_BASE_URL: z.string().optional().default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
  NBS_ACCOUNT: optionalSecret,
  NBS_PASSWORD: optionalSecret,
  NBS_COOKIE: optionalSecret,
  NBS_TOKEN: optionalSecret,
});

export type ClientEnv = z.output<typeof clientEnvSchema>;
export type ServerEnv = z.output<typeof serverEnvSchema>;

export function getClientEnv(source: Record<string, string | undefined>): ClientEnv {
  return clientEnvSchema.parse(source);
}

export function getServerEnv(source: Record<string, string | undefined>): ServerEnv {
  return serverEnvSchema.parse(source);
}

export function getConfiguredProviders(source: Pick<ServerEnv, "DEEPSEEK_API_KEY" | "GLM_API_KEY" | "QWEN_API_KEY">) {
  return {
    deepseekReasoner: Boolean(source.DEEPSEEK_API_KEY),
    glm5: Boolean(source.GLM_API_KEY),
    qwen35Plus: Boolean(source.QWEN_API_KEY),
  };
}

export function getRuntimeReadiness(source: Pick<
  ServerEnv,
  | "DEEPSEEK_API_KEY"
  | "GLM_API_KEY"
  | "QWEN_API_KEY"
  | "PERSISTENCE_MODE"
  | "NBS_ACCOUNT"
  | "NBS_PASSWORD"
  | "NBS_COOKIE"
  | "NBS_TOKEN"
>) {
  const configuredProviders = getConfiguredProviders(source);
  const availableProviders = Object.entries(configuredProviders)
    .filter(([, ready]) => ready)
    .map(([provider]) => provider) as Array<keyof typeof configuredProviders>;
  const hasLlmProvider = availableProviders.length > 0;
  const hasNbsCredential = Boolean(
    source.NBS_TOKEN || source.NBS_COOKIE || (source.NBS_ACCOUNT && source.NBS_PASSWORD),
  );
  const warnings: string[] = [];

  if (!hasLlmProvider) {
    warnings.push("未配置任何大模型 API Key，智能体将降级为本地规则与模板输出。");
  }

  if (!hasNbsCredential) {
    warnings.push("未配置国家统计局凭证，宏观数据将降级为公开样例数据。");
  }

  if (source.PERSISTENCE_MODE === "memory") {
    warnings.push("当前为内存持久化模式，服务重启后用户身份、偏好、记忆与历史不会保留。");
  }

  return {
    status: hasLlmProvider && source.PERSISTENCE_MODE === "file" ? "ready" : "degraded",
    runMode: hasLlmProvider ? "api_only" : "local_fallback",
    canRunWithApiOnly: hasLlmProvider,
    summary: hasLlmProvider
      ? "已满足由平台在服务端填写模型 API 后即可运行的核心条件，缺失可选数据源凭证时会自动降级。"
      : "尚未由平台在服务端填写模型 API Key，当前仅可依赖本地规则与模板降级运行。",
    warnings,
    subsystems: {
      llm: {
        status: hasLlmProvider ? "ready" : "degraded",
        summary: hasLlmProvider
          ? `已由平台配置 ${availableProviders.length} 个大模型提供方，可执行真实 LLM 路由。`
          : "尚未配置真实模型提供方，将改用本地规则工作流。",
        availableProviders,
      },
      rag: {
        status: "ready",
        summary: "实时检索默认使用网页检索，失败时自动回退到内置行业资料。",
      },
      dataSources: {
        status: hasNbsCredential ? "ready" : "degraded",
        summary: hasNbsCredential
          ? "东方财富公共连接器与国家统计局凭证链路均可用。"
          : "东方财富公共连接器可用，国家统计局将回退到公开样例数据。",
        eastmoneyMode: "public_connector",
        nbsMode: hasNbsCredential ? "credential" : "public_fallback",
      },
      persistence: {
        status: source.PERSISTENCE_MODE === "file" ? "ready" : "degraded",
        summary:
          source.PERSISTENCE_MODE === "file"
            ? "文件持久化已启用，用户身份与历史可跨会话恢复。"
            : "仅启用内存态存储，跨重启恢复能力不可用。",
        mode: source.PERSISTENCE_MODE,
      },
      agent: {
        status: hasLlmProvider ? "ready" : "degraded",
        summary: hasLlmProvider
          ? "建模、数据、RAG、LLM 与 Agent 编排链路可进入真实联调。"
          : "建模、数据与 Agent 编排可运行，但 LLM 节点将使用降级策略。",
      },
    },
  } satisfies RuntimeReadiness;
}

export function getDeploymentReadiness(source: Pick<
  ServerEnv,
  | "DEEPSEEK_API_KEY"
  | "GLM_API_KEY"
  | "QWEN_API_KEY"
  | "NBS_ACCOUNT"
  | "NBS_PASSWORD"
  | "NBS_COOKIE"
  | "NBS_TOKEN"
>) {
  const configuredProviders = getConfiguredProviders(source);
  const requiredInputs = ["至少一个模型 API Key（DeepSeek / GLM / Qwen）"];
  const optionalInputs = ["国家统计局凭证（NBS_COOKIE / NBS_TOKEN / NBS_ACCOUNT + NBS_PASSWORD）"];
  const hasRequiredProvider = Object.values(configuredProviders).some(Boolean);
  const hasOptionalNbsCredential = Boolean(
    source.NBS_TOKEN || source.NBS_COOKIE || (source.NBS_ACCOUNT && source.NBS_PASSWORD),
  );

  return {
    privateConfigMode: "server_only",
    canRunWithApiOnly: hasRequiredProvider,
    requiredInputs,
    optionalInputs,
    summary: hasRequiredProvider
      ? hasOptionalNbsCredential
        ? "平台已具备最小部署条件，服务端填写模型 API 与数据源凭证后可直接进入真实联调。"
        : "平台已具备最小部署条件，仅需服务端填写模型 API 即可运行，缺失的可选数据源凭证将自动降级。"
      : "平台尚未满足最小部署条件，需要先在服务端填写至少一个模型 API Key。",
  } satisfies DeploymentReadiness;
}

export function getEnvironmentLayer(nodeEnv: ServerEnv["NODE_ENV"]) {
  if (nodeEnv === "production") {
    return "production";
  }

  if (nodeEnv === "test") {
    return "testing";
  }

  return "development";
}

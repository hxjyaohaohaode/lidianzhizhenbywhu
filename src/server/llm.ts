import { AppError } from "./errors.js";
import type { ServerEnv } from "../shared/config.js";
import type { AgentId, DegradationEvent, ProviderAttempt, ProviderId } from "../shared/agents.js";

export type LlmCapability =
  | "planning"
  | "understanding"
  | "retrieval"
  | "review"
  | "expression"
  | "memory"
  | "conversation";

export type LlmExecutionRequest = {
  agentId: AgentId;
  capability: LlmCapability;
  prompt: string;
  context: Record<string, unknown>;
  preferredProviders?: ProviderId[];
};

export type LlmExecutionResponse = {
  provider: ProviderId;
  model: string;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  latencyMs: number;
};

export interface LlmProviderAdapter {
  readonly provider: ProviderId;
  readonly model: string;
  isAvailable(): boolean;
  complete(request: LlmExecutionRequest): Promise<LlmExecutionResponse>;
}

type RouterResult = {
  result: LlmExecutionResponse;
  attempts: ProviderAttempt[];
  degradationTrace: DegradationEvent[];
};

export type ProviderProbeResult = {
  provider: ProviderId;
  model: string;
  available: boolean;
  status: "success" | "failed" | "unavailable";
  latencyMs: number;
  response?: LlmExecutionResponse;
  error?: string;
};

const defaultProviderOrder: ProviderId[] = ["deepseekReasoner", "glm5", "qwen35Plus"];

export class ModelExecutionError extends AppError {
  readonly attempts: ProviderAttempt[];
  readonly degradationTrace: DegradationEvent[];

  constructor(options: {
    message: string;
    attempts: ProviderAttempt[];
    degradationTrace: DegradationEvent[];
  }) {
    super({
      code: "MODEL_UNAVAILABLE",
      message: options.message,
      statusCode: 503,
      details: {
        attempts: options.attempts,
      },
    });
    this.attempts = options.attempts;
    this.degradationTrace = options.degradationTrace;
  }
}

function estimateTokens(text: string) {
  return Math.max(16, Math.ceil(text.length / 4));
}

function getSystemPrompt(request: LlmExecutionRequest): string {
  const context = request.context;
  const query = String(context.query ?? "");
  const enterpriseName = String(context.enterpriseName ?? "目标企业");
  const focusMode = String(context.focusMode ?? "operationalDiagnosis");

  switch (request.capability) {
    case "planning":
      return `你是一个高级AI助手。当前用户正在进行企业诊断。围绕“${query}”，请将其拆分为记忆召回、数据理解、数学分析、行业检索、证据审校与表达生成六段链路，并优先并行运行数据理解、数学分析和行业检索。`;
    case "understanding":
      return `你是一个企业数据分析师。当前问题聚焦 ${enterpriseName} 的 ${focusMode}。请先确认用户目标、已提供数据范围、缺失指标与最终输出口径。`;
    case "retrieval":
      return `你是一个行业研究员。针对锂电池行业，当前需重点跟踪需求指数、原材料成本趋势、库存周转与政策信号，并将其与企业经营指标联动解释。`;
    case "review":
      return `你是一个严谨的审核员。在评估企业时，优先保留被数学模型和行业线索共同支撑的结论，弱化缺少证据闭环的推断，确保建议可追溯。`;
    case "expression":
      return `你是一个资深顾问。在输出结论时，先写风险等级，再写证据链，再写行动建议，最后补充需持续追踪的指标。`;
    case "memory":
      return `你是一个记忆管理模块。在记忆中应保留用户关注主题、企业标签、历史结论与本轮新增关注点，方便后续追问连续化。`;
    case "conversation":
      return `你是"锂电池企业智能诊断系统"的AI助手。你可以与用户进行日常对话，回答关于系统功能、锂电池行业基础知识等通用问题。请保持友好、专业的语气。如果用户的问题涉及企业诊断、经营分析、毛利承压等专业领域，请温和地引导用户使用系统的诊断功能。回答应简洁明了，一般不超过3句话。`;
    default:
      return `你是一个专业的锂电池企业智能诊断系统助手，请生成稳健的任务响应。`;
  }
}

export class OpenAICompatibleAdapter implements LlmProviderAdapter {
  readonly provider: ProviderId;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;

  constructor(provider: ProviderId, model: string, baseUrl: string, apiKey?: string) {
    this.provider = provider;
    this.model = model;
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  isAvailable() {
    return Boolean(this.apiKey);
  }

  async complete(request: LlmExecutionRequest): Promise<LlmExecutionResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.provider} 未配置 API_KEY`);
    }

    const startedAt = Date.now();
    const systemPrompt = getSystemPrompt(request);
    
    // Convert request.context to a readable string for the model
    const contextStr = JSON.stringify(request.context);
    const userPrompt = `Context: ${contextStr}\n\nTask: ${request.prompt}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      let response;
      try {
        response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: this.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt }
            ],
            temperature: 0.2
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API Error [${response.status}]: ${errorText}`);
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
        };
      };
      const text = data.choices?.[0]?.message?.content || "";
      const usage = data.usage || {};

      return {
        provider: this.provider,
        model: this.model,
        text,
        usage: {
          inputTokens: usage.prompt_tokens || estimateTokens(userPrompt + systemPrompt),
          outputTokens: usage.completion_tokens || estimateTokens(text),
        },
        latencyMs: Math.max(1, Date.now() - startedAt),
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(String(error));
    }
  }
}

export function createDefaultAdapters(
  env: Pick<ServerEnv, "DEEPSEEK_API_KEY" | "GLM_API_KEY" | "QWEN_API_KEY" | "DEEPSEEK_BASE_URL" | "GLM_BASE_URL" | "QWEN_BASE_URL">
) {
  return [
    new OpenAICompatibleAdapter("deepseekReasoner", "deepseek-reasoner", env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1", env.DEEPSEEK_API_KEY),
    new OpenAICompatibleAdapter("glm5", "glm-5", env.GLM_BASE_URL || "https://open.bigmodel.cn/api/paas/v4", env.GLM_API_KEY),
    new OpenAICompatibleAdapter("qwen35Plus", "qwen3.5-plus", env.QWEN_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1", env.QWEN_API_KEY),
  ] satisfies LlmProviderAdapter[];
}

export class ModelRouter {
  private readonly adapters: Map<ProviderId, LlmProviderAdapter>;

  constructor(adapters: LlmProviderAdapter[]) {
    this.adapters = new Map(adapters.map((adapter) => [adapter.provider, adapter]));
  }

  listProviders() {
    return Array.from(this.adapters.values()).map((adapter) => ({
      provider: adapter.provider,
      model: adapter.model,
      available: adapter.isAvailable(),
    }));
  }

  async probeProvider(provider: ProviderId, request: LlmExecutionRequest): Promise<ProviderProbeResult> {
    const adapter = this.adapters.get(provider);

    if (!adapter || !adapter.isAvailable()) {
      return {
        provider,
        model: adapter?.model ?? "unconfigured",
        available: false,
        status: "unavailable",
        latencyMs: 0,
        error: "provider not configured",
      };
    }

    try {
      const response = await adapter.complete(request);
      return {
        provider,
        model: response.model,
        available: true,
        status: "success",
        latencyMs: response.latencyMs,
        response,
      };
    } catch (error) {
      return {
        provider,
        model: adapter.model,
        available: true,
        status: "failed",
        latencyMs: 0,
        error: error instanceof Error ? error.message : "unknown error",
      };
    }
  }

  async complete(request: LlmExecutionRequest): Promise<RouterResult> {
    const attempts: ProviderAttempt[] = [];
    const degradationTrace: DegradationEvent[] = [];
    const orderedProviders = request.preferredProviders?.length
      ? Array.from(new Set(request.preferredProviders))
      : defaultProviderOrder;

    for (const provider of orderedProviders) {
      const adapter = this.adapters.get(provider);

      if (!adapter || !adapter.isAvailable()) {
        attempts.push({
          provider,
          model: adapter?.model ?? "unconfigured",
          status: "unavailable",
          latencyMs: 0,
          error: "provider not configured",
        });
        degradationTrace.push({
          agentId: request.agentId,
          reason: "provider_unavailable",
          provider,
          message: `${provider} 当前不可用，已切换到后续提供方。`,
          occurredAt: new Date().toISOString(),
        });
        continue;
      }

      try {
        const result = await adapter.complete(request);
        attempts.push({
          provider,
          model: result.model,
          status: "success",
          latencyMs: result.latencyMs,
        });
        return {
          result,
          attempts,
          degradationTrace,
        };
      } catch (error) {
        attempts.push({
          provider,
          model: adapter.model,
          status: "failed",
          latencyMs: 0,
          error: error instanceof Error ? error.message : "unknown error",
        });
        degradationTrace.push({
          agentId: request.agentId,
          reason: "provider_failed",
          provider,
          message: `${provider} 调用失败，已降级尝试其他模型。`,
          occurredAt: new Date().toISOString(),
        });
      }
    }

    throw new ModelExecutionError({
      message: "当前没有可用的大模型提供方。",
      attempts,
      degradationTrace,
    });
  }
}

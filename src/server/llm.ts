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
  | "conversation"
  | "queryUnderstanding"
  | "reranking"
  | "evidenceEvaluation"
  | "dataQualityAssessment";

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
      return `你是锂电池行业经营诊断系统的任务规划专家。你的职责是根据用户查询和企业经营数据，制定结构化的分析计划。\n\n输出要求：\n1. 以JSON格式输出，包含 tasks 数组\n2. 每个任务包含 id、name、description、dependencies、requiredData 字段\n3. 任务应覆盖：数据完整性检查→指标计算→趋势分析→风险识别→结论生成\n4. 依赖关系必须形成有向无环图(DAG)\n5. 当数据不足时，在任务描述中标注[数据缺失]并建议补充方案\n\n核心分析框架约束：\n- 经营质量分析必须调用DQI模型（权重：w1=0.4盈利能力, w2=0.3成长能力, w3=0.3现金流质量）\n- 毛利承压分析必须调用GMPS模型（五层十维：A毛利率结果, B材料成本冲击, C产销负荷, D外部风险, E现金流安全）\n- 风险预测必须包含Logistic回归概率计算\n- 计划中必须包含DQI三维度分解和GMPS五维度得分分析任务\n\n领域约束：\n- 锂电池行业毛利率通常在15%-30%之间\n- 碳酸锂价格波动是核心成本驱动因素\n- 产能利用率和库存周转是经营质量的关键指标\n- 需区分动力电池、储能电池、消费电池三条产品线的差异`;
    case "understanding":
      return `你是锂电池行业数据分析专家。你的职责是深入理解企业经营数据，识别关键趋势和异常信号。\n\n输出要求：\n1. 以JSON格式输出，包含 findings、trends、anomalies、gaps 四个字段\n2. findings: 关键发现列表，每条包含 metric、direction、magnitude、significance\n3. trends: 趋势判断，包含 direction(up/down/stable)、confidence(0-1)、evidence\n4. anomalies: 异常信号，包含 metric、expectedRange、actualValue、severity(high/medium/low)\n5. gaps: 数据缺失项，包含 field、impact、suggestion\n\n领域约束：\n- 毛利率下降超过3个百分点视为显著恶化\n- 库存周转天数超过120天视为库存积压风险\n- 经营现金流为负且持续恶化视为高危信号\n- 产销率低于80%或超过100%均需重点关注\n\n当数据不足时：\n- 明确标注缺失项及其对分析结论的影响程度\n- 基于可用数据给出条件性结论，并说明前提假设\n- 不编造或推测缺失数据的具体数值`;
    case "retrieval":
      return `你是一个行业研究员。针对锂电池行业，当前需重点跟踪需求指数、原材料成本趋势、库存周转与政策信号，并将其与企业经营指标联动解释。`;
    case "review":
      return `你是锂电池行业诊断质量审核专家。你的职责是审核分析结论的证据充分性、逻辑一致性和结论可靠性。\n\n审核标准（证据闭环量化）：\n1. 证据充分性：每个结论至少有2个独立数据点支撑，得分为支撑数据点数/所需数据点数\n2. 逻辑一致性：结论之间无矛盾，因果链条完整，得分为无矛盾结论数/总结论数\n3. 数据时效性：引用数据不超过2个季度，得分为新鲜数据引用次数/总数据引用次数\n4. 领域准确性：行业基准引用正确，阈值设定合理，得分为正确引用数/总引用数\n\n输出要求：\n1. 以JSON格式输出，包含 overallScore、dimensions、issues、recommendations\n2. overallScore: 0-100的综合质量分\n3. dimensions: 四个维度的评分详情\n4. issues: 发现的质量问题列表\n5. recommendations: 改进建议列表\n\n模型结果审核强制要求：\n1. 审核DQI结论时，验证DQI指数计算是否符合公式：DQI_t = w1·(ROE_t/ROE_{t-1}) + w2·(Growth_t/Growth_{t-1}) + w3·(OCF_t/OCF_{t-1})\n2. 审核GMPS结论时，验证五维度得分是否在合理范围（0-100），总分是否符合加权求和公式\n3. 检查结论中是否正确引用了模型名称和具体数值\n4. 验证Logistic风险概率计算是否在(0,1)区间内\n\n领域约束：\n- 锂电池行业毛利率基准为20%±5%\n- 碳酸锂价格波动率超过30%视为高波动环境\n- 产能利用率行业基准为75%-85%`;
    case "expression":
      return `你是锂电池行业诊断报告撰写专家。你的职责是将分析结论转化为专业、清晰、可执行的经营诊断报告。\n\n输出要求：\n1. 使用Markdown格式\n2. 报告结构：执行摘要→关键发现→风险预警→改善建议→数据附录\n3. 执行摘要不超过200字，突出核心结论\n4. 关键发现按重要性排序，每条包含：指标名称→当前值→行业对比→趋势判断\n5. 风险预警使用🔴高危🟡中危🟢低危标记\n6. 改善建议必须具体可执行，包含目标值和时间框架\n\n【核心数学模型约束——所有结论必须基于以下模型计算结果，禁止脱离模型主观臆断】\n\nDQI经营质量模型公式:\n- ROE = 净利润 / 平均净资产 × 100%\n- E_t = α·ROE_t + β·OCF_t\n- DQI_t = w1·(ROE_t/ROE_{t-1}) + w2·(Growth_t/Growth_{t-1}) + w3·(OCF_t/OCF_{t-1})\n- 权重: w1=0.4(盈利能力), w2=0.3(成长能力), w3=0.3(现金流质量)\n- DQI>1:改善, DQI=1:稳定, DQI<1:恶化\n\nGMPS毛利承压模型公式:\n- 五层十维特征: A层(毛利率结果), B层(材料成本冲击), C层(产销负荷), D层(外部风险), E层(现金流安全)\n- 标准化打分: score(x) = 20+60·(x-L)/(H-L) (越大越危险) 或 80-60·(x-L)/(H-L) (越小越危险)\n- GMPS = Σ w_k · score_k (权重: gpmYoy=0.14, revCostGap=0.11, liPriceYoy=0.10, unitCostYoy=0.12, invYoy=0.09, saleProdRatio=0.10, mfgCostRatio=0.12, indVol=0.07, cfoRatio=0.08, lev=0.07)\n- 等级: GMPS<40低压, 40≤GMPS<70中压, GMPS≥70高压\n- Logistic预测: P = 1/(1+exp(-(β0+β1·GMPS+Σβd·S_d)))\n\n输出引用强制要求：\n1. 当引用经营质量结论时，必须明确标注"根据DQI模型"并引用具体计算结果（如DQI指数值、三维度分解、驱动因素）\n2. 当引用毛利承压结论时，必须明确标注"根据GMPS模型"并引用具体得分（如GMPS总分、五维度得分、风险概率）\n3. 示例正确引用："根据GMPS模型，材料成本冲击维度得分72.5分（高压区间），是当前毛利承压的首要来源"\n4. 示例正确引用："根据DQI模型，经营质量指数为0.87（恶化状态），其中现金流质量维度贡献度-0.15为主要拖累因素"\n5. 禁止使用模糊表述如"经营质量下降"而不引用模型具体数值\n6. 当DQI与GMPS结论冲突时，必须在报告中明确说明冲突点并给出优先级判断依据\n\n领域约束：\n- 所有数值保留2位小数\n- 金额单位统一为万元\n- 百分比以%表示，不使用小数\n- 引用行业数据时标注来源和时效`;
    case "memory":
      return `你是一个记忆管理模块。在记忆中应保留用户关注主题、企业标签、历史结论与本轮新增关注点，方便后续追问连续化。`;
    case "conversation":
      return `你是"锂电池企业智能诊断系统"的AI助手。你可以与用户进行日常对话，回答关于系统功能、锂电池行业基础知识等通用问题。请保持友好、专业的语气。如果用户的问题涉及企业诊断、经营分析、毛利承压等专业领域，请温和地引导用户使用系统的诊断功能。回答应简洁明了，一般不超过3句话。`;
    case "queryUnderstanding":
      return `你是锂电池行业检索查询理解专家。从用户查询中提取：1.意图(趋势分析/对比评估/风险识别/投资决策) 2.实体(企业名/产品线/指标名) 3.扩展词(同义词/相关术语/行业术语) 4.查询类型(factual/analytical/comparative)。输出JSON格式。`;
    case "reranking":
      return `你是锂电池行业文献相关性排序专家。根据查询意图对检索结果重新排序。排序标准：1.与查询意图的语义匹配度 2.数据时效性(优先近6个月) 3.来源权威性(官方>研报>媒体) 4.内容完整性。输出排序后的ID列表和排序理由。`;
    case "evidenceEvaluation":
      return `你是锂电池行业证据质量评估专家。评估检索证据的：1.可靠性(来源权威性) 2.时效性(数据新鲜度) 3.相关性(与查询匹配度) 4.充分性(证据链完整性)。输出质量评分(0-100)和改进建议。`;
    case "dataQualityAssessment":
      return `你是一个数据质量评估专家。你的任务是评估输入数据的完整性、一致性和合理性。你需要识别数据中的异常值、缺失值和潜在错误，并给出数据质量评分和改进建议。输出必须是严格的JSON格式。`;
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
            temperature: 0.2,
            max_tokens: 2000
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

    const availableProviders = orderedProviders.filter((provider) => {
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
        return false;
      }
      return true;
    });

    if (availableProviders.length === 0) {
      throw new ModelExecutionError({
        message: "当前没有可用的大模型提供方。",
        attempts,
        degradationTrace,
      });
    }

    if (availableProviders.length === 1) {
      const provider = availableProviders[0] as ProviderId;
      const adapter = this.adapters.get(provider)!;
      try {
        const result = await adapter.complete(request);
        attempts.push({
          provider,
          model: result.model,
          status: "success",
          latencyMs: result.latencyMs,
        });
        return { result, attempts, degradationTrace };
      } catch (error) {
        attempts.push({
          provider,
          model: adapter.model,
          status: "failed",
          latencyMs: 0,
          error: error instanceof Error ? error.message : "unknown error",
        });
        throw new ModelExecutionError({
          message: "当前没有可用的大模型提供方。",
          attempts,
          degradationTrace,
        });
      }
    }

    const primaryProvider = availableProviders[0] as ProviderId;
    const fallbackProvider = availableProviders[1] as ProviderId;
    const primaryAdapter = this.adapters.get(primaryProvider)!;
    const fallbackAdapter = this.adapters.get(fallbackProvider)!;

    const primaryPromise = primaryAdapter.complete(request);
    const fallbackTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("primary provider timeout")), 15000)
    );

    try {
      const result = await Promise.race([primaryPromise, fallbackTimeout]);
      attempts.push({
        provider: primaryProvider,
        model: result.model,
        status: "success",
        latencyMs: result.latencyMs,
      });
      return { result, attempts, degradationTrace };
    } catch (error) {
      attempts.push({
        provider: primaryProvider,
        model: primaryAdapter.model,
        status: "failed",
        latencyMs: 0,
        error: error instanceof Error ? error.message : "unknown error",
      });
      degradationTrace.push({
        agentId: request.agentId,
        reason: "provider_failed",
        provider: primaryProvider,
        message: `${primaryProvider} 调用超时或失败，已降级到 ${fallbackProvider}。`,
        occurredAt: new Date().toISOString(),
      });

      try {
        const result = await fallbackAdapter.complete(request);
        attempts.push({
          provider: fallbackProvider,
          model: result.model,
          status: "success",
          latencyMs: result.latencyMs,
        });
        return { result, attempts, degradationTrace };
      } catch (fallbackError) {
        attempts.push({
          provider: fallbackProvider,
          model: fallbackAdapter.model,
          status: "failed",
          latencyMs: 0,
          error: fallbackError instanceof Error ? fallbackError.message : "unknown error",
        });

        for (const provider of availableProviders.slice(2)) {
          const adapter = this.adapters.get(provider as ProviderId)!;
          try {
            const result = await adapter.complete(request);
            attempts.push({
              provider: provider as ProviderId,
              model: result.model,
              status: "success",
              latencyMs: result.latencyMs,
            });
            return { result, attempts, degradationTrace };
          } catch (err) {
            attempts.push({
              provider: provider as ProviderId,
              model: adapter.model,
              status: "failed",
              latencyMs: 0,
              error: err instanceof Error ? err.message : "unknown error",
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
  }
}

import { randomUUID } from "node:crypto";

import type { MemoryCategory, MemoryEntry } from "../shared/agents.js";
import type { PlatformStore } from "./platform-store.js";

type MemoryWriteInput = Omit<MemoryEntry, "id" | "createdAt"> &
  Partial<Pick<MemoryEntry, "id" | "createdAt">>;

export type MemoryContentType = MemoryCategory;

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  userProfile: "用户画像",
  enterpriseInsight: "企业洞察",
  decisionRecord: "决策记录",
  knowledgeDeposit: "知识沉淀",
  temporaryData: "临时数据",
  intermediateProcess: "中间过程",
  unknown: "未分类",
};

export type MemoryValueScore = {
  shouldRemember: boolean;
  contentType: MemoryContentType;
  valueScore: number;
  retentionPriority: "high" | "medium" | "low" | "discard";
  reasons: string[];
  confidence: number;
};

type ContentPattern = {
  patterns: RegExp[];
  contentType: MemoryContentType;
  valueBase: number;
  isTemporary: boolean;
};

const CONTENT_PATTERNS: ContentPattern[] = [
  {
    patterns: [
      /风险偏好[是为]/,
      /投资风格[是为]/,
      /关注领域[是为]/,
      /长期偏好/,
      /投资周期[是为]/,
      /资金成本[是为]/,
      /保守|稳健|激进/,
      /偏好.*风险/,
      /关注.*领域/,
      /重点跟踪/,
      /长期持有/,
      /价值投资/,
      /用户画像/,
      /个人偏好/,
      /投资目标/,
      /风险承受/,
      /收益预期/,
      /资产配置偏好/,
      /行业偏好/,
      /风格偏好/,
      /用户习惯/,
      /操作习惯/,
      /显示偏好/,
      /主题偏好/,
      /单位偏好/,
    ],
    contentType: "userProfile",
    valueBase: 85,
    isTemporary: false,
  },
  {
    patterns: [
      /行业洞察/,
      /企业.*洞察/,
      /竞争格局/,
      /行业趋势/,
      /供需关系/,
      /成本结构/,
      /盈利模式/,
      /核心竞争力/,
      /护城河/,
      /行业地位/,
      /市场份额/,
      /技术路线/,
      /产能布局/,
      /企业诊断/,
      /经营分析/,
      /财务分析/,
      /毛利率.*压力/,
      /经营质量/,
      /盈利能力/,
      /成长能力/,
      /现金流质量/,
      /风险水平/,
      /企业画像/,
      /行业对比/,
      /同业分析/,
      /产业链分析/,
      /供应链风险/,
      /市场前景/,
      /行业周期/,
      /竞争态势/,
    ],
    contentType: "enterpriseInsight",
    valueBase: 80,
    isTemporary: false,
  },
  {
    patterns: [
      /决策依据/,
      /决策偏好/,
      /历史决策/,
      /投资决策/,
      /配置建议/,
      /调仓记录/,
      /止损.*设置/,
      /止盈.*设置/,
      /仓位管理/,
      /分批.*操作/,
      /左侧.*交易/,
      /右侧.*交易/,
      /决策记录/,
      /操作建议/,
      /投资建议/,
      /风险提示/,
      /应对策略/,
      /调整方案/,
      /优化建议/,
      /行动建议/,
      /改进措施/,
      /决策逻辑/,
      /判断依据/,
      /分析结论/,
    ],
    contentType: "decisionRecord",
    valueBase: 75,
    isTemporary: false,
  },
  {
    patterns: [
      /长期有效/,
      /行业规律/,
      /经验总结/,
      /方法论/,
      /分析框架/,
      /投资逻辑/,
      /估值方法/,
      /财务指标.*解读/,
      /行业知识/,
      /专业术语/,
      /知识沉淀/,
      /学习笔记/,
      /经验教训/,
      /最佳实践/,
      /操作指南/,
      /分析模板/,
      /评估模型/,
      /诊断模型/,
      /DQI/,
      /GMPS/,
      /毛利率压力/,
      /经营质量指数/,
      /财务指标/,
      /行业基准/,
    ],
    contentType: "knowledgeDeposit",
    valueBase: 70,
    isTemporary: false,
  },
  {
    patterns: [
      /今日.*价格/,
      /本周.*波动/,
      /短期.*走势/,
      /临时.*新闻/,
      /最新.*公告/,
      /实时.*数据/,
      /当前.*报价/,
      /盘中.*变化/,
      /日内.*波动/,
      /短期.*震荡/,
      /临时查询/,
      /一次性查询/,
      /当前状态/,
    ],
    contentType: "temporaryData",
    valueBase: 15,
    isTemporary: true,
  },
  {
    patterns: [
      /正在.*计算/,
      /推理过程/,
      /临时.*结果/,
      /中间.*步骤/,
      /处理中/,
      /分析中/,
      /正在.*分析/,
      /临时.*变量/,
      /中间.*状态/,
      /计算过程/,
      /数据处理/,
    ],
    contentType: "intermediateProcess",
    valueBase: 10,
    isTemporary: true,
  },
];

const TEMPORARY_KEYWORDS = [
  "今天",
  "本周",
  "本月",
  "当前",
  "最新",
  "实时",
  "临时",
  "测试",
  "尝试",
  "一次性",
  "单次",
  "暂时",
  "短期",
  "日内",
  "盘中",
];

const PERMANENT_KEYWORDS = [
  "长期",
  "一直",
  "始终",
  "永久",
  "持续",
  "稳定",
  "固定",
  "习惯",
  "偏好",
  "风格",
];

const TEST_PATTERNS = [
  /^测试/,
  /^test/i,
  /^尝试/,
  /^试试/,
  /^demo$/i,
  /^示例/,
  /^样例/,
  /^example/i,
];

function extractKeywords(text: string): string[] {
  const keywords: string[] = [];
  const segments = text.split(/[，。；！？、\s\n]+/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.length >= 2 && trimmed.length <= 20) {
      keywords.push(trimmed);
    }
  }
  return keywords;
}

function detectContentType(summary: string, details?: string): MemoryContentType {
  const fullText = `${summary} ${details ?? ""}`.toLowerCase();
  
  for (const pattern of CONTENT_PATTERNS) {
    for (const regex of pattern.patterns) {
      if (regex.test(fullText)) {
        return pattern.contentType;
      }
    }
  }
  
  return "unknown";
}

function isTemporaryContent(summary: string, details?: string): boolean {
  const fullText = `${summary} ${details ?? ""}`.toLowerCase();
  
  for (const pattern of TEST_PATTERNS) {
    if (pattern.test(summary.trim())) {
      return true;
    }
  }
  
  let temporaryCount = 0;
  let permanentCount = 0;
  
  for (const keyword of TEMPORARY_KEYWORDS) {
    if (fullText.includes(keyword)) {
      temporaryCount++;
    }
  }
  
  for (const keyword of PERMANENT_KEYWORDS) {
    if (fullText.includes(keyword)) {
      permanentCount++;
    }
  }
  
  if (temporaryCount > 0 && permanentCount === 0) {
    return true;
  }
  
  if (temporaryCount >= 2 && permanentCount < temporaryCount) {
    return true;
  }
  
  return false;
}

function isOneTimeQuery(summary: string): boolean {
  const trimmed = summary.trim();
  
  if (TEST_PATTERNS.some((p) => p.test(trimmed))) {
    return true;
  }
  
  const oneTimePatterns = [
    /^查一下/,
    /^看看/,
    /^帮我查/,
    /^查询/,
    /^搜索/,
    /^找找/,
    /^这个.*多少/,
    /^那个.*什么/,
  ];
  
  for (const pattern of oneTimePatterns) {
    if (pattern.test(trimmed)) {
      return true;
    }
  }
  
  return false;
}

function calculateValueScore(
  contentType: MemoryContentType,
  summary: string,
  details?: string,
  tags?: string[],
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 50;
  
  const pattern = CONTENT_PATTERNS.find((p) => p.contentType === contentType);
  if (pattern) {
    score = pattern.valueBase;
    reasons.push(`内容类型识别为: ${contentType}`);
  } else {
    reasons.push("内容类型未能明确识别");
  }
  
  const fullText = `${summary} ${details ?? ""}`;
  
  const permanentKeywords = PERMANENT_KEYWORDS.filter((k) => fullText.includes(k));
  if (permanentKeywords.length > 0) {
    score += Math.min(15, permanentKeywords.length * 5);
    reasons.push(`包含长期性关键词: ${permanentKeywords.slice(0, 3).join("、")}`);
  }
  
  const temporaryKeywords = TEMPORARY_KEYWORDS.filter((k) => fullText.includes(k));
  if (temporaryKeywords.length > 0) {
    score -= Math.min(25, temporaryKeywords.length * 8);
    reasons.push(`包含临时性关键词: ${temporaryKeywords.slice(0, 3).join("、")}`);
  }
  
  if (tags && tags.length > 0) {
    const meaningfulTags = tags.filter((t) => t.length >= 2 && !TEMPORARY_KEYWORDS.includes(t));
    if (meaningfulTags.length > 0) {
      score += Math.min(10, meaningfulTags.length * 3);
      reasons.push(`包含有意义的标签: ${meaningfulTags.slice(0, 3).join("、")}`);
    }
  }
  
  if (summary.length < 5) {
    score -= 20;
    reasons.push("摘要过短，信息量不足");
  } else if (summary.length >= 10 && summary.length <= 100) {
    score += 5;
    reasons.push("摘要长度适中");
  }
  
  if (details && details.length > 50) {
    score += 5;
    reasons.push("包含详细内容");
  }
  
  return { score: Math.max(0, Math.min(100, score)), reasons };
}

export function evaluateMemoryValue(
  summary: string,
  details?: string,
  tags?: string[],
): MemoryValueScore {
  const reasons: string[] = [];
  
  const contentType = detectContentType(summary, details);
  reasons.push(`内容类型: ${contentType}`);
  
  if (isOneTimeQuery(summary)) {
    return {
      shouldRemember: false,
      contentType: "temporaryData",
      valueScore: 10,
      retentionPriority: "discard",
      reasons: ["识别为一次性查询，不建议记忆", ...reasons],
      confidence: 0.9,
    };
  }
  
  if (isTemporaryContent(summary, details)) {
    return {
      shouldRemember: false,
      contentType: contentType === "unknown" ? "temporaryData" : contentType,
      valueScore: 20,
      retentionPriority: "discard",
      reasons: ["识别为临时性内容，不建议记忆", ...reasons],
      confidence: 0.85,
    };
  }
  
  const { score, reasons: scoreReasons } = calculateValueScore(contentType, summary, details, tags);
  reasons.push(...scoreReasons);
  
  const isValuableContentType = [
    "userProfile",
    "enterpriseInsight",
    "decisionRecord",
    "knowledgeDeposit",
  ].includes(contentType);
  
  // workflow来源的记忆放宽条件：只要不是临时内容且有基本长度即可
  const isWorkflowSource = tags?.includes("workflow") ?? false;
  const hasMinimumLength = summary.length >= 8;
  const shouldRemember = isWorkflowSource 
    ? hasMinimumLength && score >= 30  // workflow来源：score >= 30即可
    : isValuableContentType && score >= 50;  // 其他来源：保持原有严格条件
  
  let retentionPriority: MemoryValueScore["retentionPriority"];
  if (score >= 75) {
    retentionPriority = "high";
  } else if (score >= 50) {
    retentionPriority = "medium";
  } else if (score >= 30) {
    retentionPriority = "low";
  } else {
    retentionPriority = "discard";
  }
  
  const confidence = contentType !== "unknown" ? 0.85 : 0.6;
  
  return {
    shouldRemember,
    contentType,
    valueScore: score,
    retentionPriority,
    reasons,
    confidence,
  };
}

export function filterMemoryCandidates(
  candidates: Array<{ summary: string; details?: string; tags?: string[] }>,
): Array<{ summary: string; details?: string; tags?: string[]; evaluation: MemoryValueScore }> {
  return candidates
    .map((candidate) => ({
      ...candidate,
      evaluation: evaluateMemoryValue(candidate.summary, candidate.details, candidate.tags),
    }))
    .filter((item) => item.evaluation.shouldRemember)
    .sort((a, b) => b.evaluation.valueScore - a.evaluation.valueScore);
}

export function shouldWriteMemory(
  summary: string,
  details?: string,
  tags?: string[],
): { shouldWrite: boolean; evaluation: MemoryValueScore } {
  const evaluation = evaluateMemoryValue(summary, details, tags);
  
  return {
    shouldWrite: evaluation.shouldRemember && evaluation.retentionPriority !== "discard",
    evaluation,
  };
}

export function classifyMemory(
  summary: string,
  details?: string,
  tags?: string[],
): {
  category: MemoryCategory;
  confidence: number;
  categoryTag: string;
} {
  const evaluation = evaluateMemoryValue(summary, details, tags);
  const category = evaluation.contentType as MemoryCategory;
  const confidence = evaluation.confidence;
  const categoryTag = MEMORY_CATEGORY_LABELS[category] ?? "未分类";
  
  return { category, confidence, categoryTag };
}

export function enrichTagsWithCategory(
  tags: string[],
  category: MemoryCategory,
): string[] {
  const categoryTag = MEMORY_CATEGORY_LABELS[category];
  if (!categoryTag) {
    return tags;
  }
  
  const existingCategoryTags = Object.values(MEMORY_CATEGORY_LABELS);
  const filteredTags = tags.filter((tag) => !existingCategoryTags.includes(tag));
  
  return [categoryTag, ...filteredTags];
}

export const MAX_MEMORIES_PER_USER = 50;
export const MEMORY_CLEANUP_THRESHOLD = 40;
export const MEMORY_CLEANUP_KEEP = 25;

export class InMemoryMemoryStore {
  private readonly entries = new Map<string, MemoryEntry[]>();

  constructor(private readonly platformStore?: PlatformStore) {}

  list(userId: string, limit = 5, role?: string, tags?: string[]) {
    const items = this.platformStore
      ? this.platformStore.listMemories(userId)
      : [...(this.entries.get(userId) ?? [])];

    return [...items]
      .filter((item) => !role || item.role === role)
      .filter((item) => !tags || tags.length === 0 || tags.some((tag) => item.tags.includes(tag)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  get(userId: string, memoryId: string) {
    const entries = this.platformStore
      ? this.platformStore.listMemories(userId)
      : this.entries.get(userId) ?? [];

    return entries.find((entry) => entry.id === memoryId);
  }

  async write(input: MemoryWriteInput) {
    const classification = classifyMemory(input.summary, input.details, input.tags);
    const enrichedTags = enrichTagsWithCategory(input.tags ?? [], classification.category);
    
    const entry: MemoryEntry = {
      id: input.id ?? randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
      userId: input.userId,
      summary: input.summary,
      tags: enrichedTags,
      details: input.details,
      role: input.role,
      conversationId: input.conversationId,
      source: input.source,
      category: classification.category,
      categoryConfidence: classification.confidence,
    };

    if (this.platformStore) {
      await this.platformStore.saveMemory(entry);
      await this.enforceMemoryLimit(entry.userId);
      return entry;
    }

    const nextEntries = [...(this.entries.get(entry.userId) ?? []), entry];
    this.entries.set(entry.userId, nextEntries);
    return entry;
  }

  private async enforceMemoryLimit(userId: string) {
    if (!this.platformStore) return;
    const allMemories = this.platformStore.listMemories(userId);
    if (allMemories.length < MEMORY_CLEANUP_THRESHOLD) return;

    const scored = allMemories.map((m) => {
      const evaluation = evaluateMemoryValue(m.summary, m.details, m.tags);
      return { memory: m, score: evaluation.valueScore, priority: evaluation.retentionPriority };
    });

    scored.sort((a, b) => {
      if (a.priority === "discard" && b.priority !== "discard") return 1;
      if (a.priority !== "discard" && b.priority === "discard") return -1;
      return a.score - b.score;
    });

    const toDelete = scored.slice(0, allMemories.length - MEMORY_CLEANUP_KEEP);
    for (const item of toDelete) {
      if (item.priority === "high") continue;
      await this.platformStore.deleteMemory(userId, item.memory.id);
    }
  }

  async writeWithFilter(input: MemoryWriteInput): Promise<{
    entry: MemoryEntry | null;
    evaluation: MemoryValueScore;
    filtered: boolean;
  }> {
    // workflow来源的记忆放宽过滤条件
    const isWorkflowSource = input.source === "workflow";
    
    if (isWorkflowSource) {
      // workflow来源：只做最基本的检查（非一次性查询且有基本长度）
      if (isOneTimeQuery(input.summary)) {
        const evaluation: MemoryValueScore = {
          shouldRemember: false,
          contentType: "temporaryData",
          valueScore: 10,
          retentionPriority: "discard",
          reasons: ["识别为一次性查询，不建议记忆"],
          confidence: 0.9,
        };
        return { entry: null, evaluation, filtered: true };
      }
      
      // 有基本长度就允许写入
      if (input.summary.length < 5) {
        const evaluation: MemoryValueScore = {
          shouldRemember: false,
          contentType: "unknown",
          valueScore: 15,
          retentionPriority: "discard",
          reasons: ["摘要过短"],
          confidence: 0.7,
        };
        return { entry: null, evaluation, filtered: true };
      }
      
      // 直接写入
      const entry = await this.write(input);
      const evaluation: MemoryValueScore = {
        shouldRemember: true,
        contentType: "enterpriseInsight",
        valueScore: 50,
        retentionPriority: "medium",
        reasons: ["workflow来源，自动允许"],
        confidence: 0.8,
      };
      return { entry, evaluation, filtered: false };
    }
    
    // 非workflow来源：使用原有的严格过滤逻辑
    const evaluation = evaluateMemoryValue(input.summary, input.details, input.tags);
    
    if (!evaluation.shouldRemember || evaluation.retentionPriority === "discard") {
      return {
        entry: null,
        evaluation,
        filtered: true,
      };
    }
    
    const entry = await this.write(input);
    
    return {
      entry,
      evaluation,
      filtered: false,
    };
  }

  append(input: MemoryWriteInput) {
    return this.write(input);
  }

  appendWithFilter(input: MemoryWriteInput) {
    return this.writeWithFilter(input);
  }

  async update(userId: string, memoryId: string, input: Pick<MemoryEntry, "summary" | "details" | "tags">) {
    const classification = classifyMemory(input.summary, input.details, input.tags);
    const enrichedTags = enrichTagsWithCategory(input.tags ?? [], classification.category);
    
    if (this.platformStore) {
      return await this.platformStore.updateMemory(userId, memoryId, (current) => ({
        ...current,
        summary: input.summary,
        details: input.details,
        tags: enrichedTags,
        category: classification.category,
        categoryConfidence: classification.confidence,
      }));
    }

    const entries = [...(this.entries.get(userId) ?? [])];
    const index = entries.findIndex((entry) => entry.id === memoryId);
    if (index < 0) {
      return undefined;
    }
    entries[index] = {
      ...entries[index]!,
      summary: input.summary,
      details: input.details,
      tags: enrichedTags,
      category: classification.category,
      categoryConfidence: classification.confidence,
    };
    this.entries.set(userId, entries);
    return entries[index];
  }

  async delete(userId: string, memoryId: string) {
    if (this.platformStore) {
      return await this.platformStore.deleteMemory(userId, memoryId);
    }

    const entries = this.entries.get(userId) ?? [];
    const deleted = entries.find((entry) => entry.id === memoryId);
    this.entries.set(
      userId,
      entries.filter((entry) => entry.id !== memoryId),
    );
    return deleted;
  }
}

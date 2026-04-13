import { createHash } from "node:crypto";

import type { CitationConfidence, IndustryCitation, RagDocumentType } from "../shared/agents.js";
import type { RealtimeRagIndexStats, RealtimeRagRequest, RealtimeRagResponse } from "../shared/rag.js";

type CuratedPage = {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  html: string;
};

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
  rankScore: number;
};

export type WebSearchResponse = {
  items: WebSearchResult[];
  providerName: string;
  fallbackUsed: boolean;
};

export type WebPageResult = {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  html: string;
};

export interface WebSearchProvider {
  search(request: { query: string; limit: number }): Promise<WebSearchResponse>;
}

export interface WebPageFetcher {
  fetch(result: WebSearchResult): Promise<WebPageResult>;
}

type RagDependencies = {
  searchProvider?: WebSearchProvider;
  fallbackSearchProvider?: WebSearchProvider;
  pageFetcher?: WebPageFetcher;
  fallbackPageFetcher?: WebPageFetcher;
  now?: () => Date;
  cacheTtlMs?: number;
  sourceWhitelist?: string[];
  maxSourceAgeDays?: number;
};

type ChunkMetadata = {
  isFinancialData: boolean;
  metrics: string[];
  entities: string[];
};

type IndexedChunk = {
  documentId: string;
  documentKey: string;
  documentType: RagDocumentType;
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  chunkIndex: number;
  chunkLength: number;
  contentHash: string;
  chunkText: string;
  metadata: ChunkMetadata;
  lexicalScore: number;
  metadataScore: number;
  authorityScore: number;
  freshnessScore: number;
  searchRankScore: number;
  relevanceScore: number;
  confidenceScore: number;
  confidence: CitationConfidence;
};

type CachedResponse = {
  storedAt: number;
  response: RealtimeRagResponse;
};

const curatedPages: CuratedPage[] = [
  {
    title: "星海电池2025年年度报告摘要：毛利率承压但经营现金流改善",
    url: "https://reports.example.com/xinghai-battery-annual-report-2025",
    source: "企业财报库",
    publishedAt: "2026-03-28",
    html: `
      <html>
        <head><title>星海电池2025年年度报告摘要</title></head>
        <body>
          <article>
            <h1>星海电池2025年年度报告摘要</h1>
            <p>公司年报显示，2025年营业收入同比增长12.4%，但受价格竞争影响，综合毛利率同比下降2.1个百分点。</p>
            <p>经营活动现金流净额达到18.6亿元，同比改善，库存周转天数较上年末下降9天。</p>
            <p>管理层强调将继续优化高毛利储能产品结构，并控制资本开支节奏。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "2026锂电池行业深度研报：库存去化与储能招标共振",
    url: "https://research.example.edu/battery-industry-deep-report-2026",
    source: "行业研报中心",
    publishedAt: "2026-03-26",
    html: `
      <html>
        <head><title>2026锂电池行业深度研报</title></head>
        <body>
          <article>
            <h1>2026锂电池行业深度研报：库存去化与储能招标共振</h1>
            <p>研报指出，行业库存去化进入后半程，储能招标放量带动二季度订单前瞻改善。</p>
            <p>若企业现金流质量同步改善，盈利修复斜率通常快于仅依赖价格反弹的企业。</p>
            <p>建议重点跟踪出货兑现率、库存费用、经营现金流和政策节奏。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "2026年一季度动力电池需求延续增长",
    url: "https://insights.example.com/battery-demand-q1-2026",
    source: "电池行业观察",
    publishedAt: "2026-03-18",
    html: `
      <html>
        <head><title>2026年一季度动力电池需求延续增长</title></head>
        <body>
          <article>
            <h1>2026年一季度动力电池需求延续增长</h1>
            <p>2026年一季度，新能源汽车与储能订单继续提升，头部电池企业排产保持高位。</p>
            <p>行业调研显示，终端需求同比继续增长，主流企业对二季度排产仍保持谨慎乐观。</p>
            <p>部分企业通过优化产品结构提升高附加值产品占比，带动盈利修复节奏快于去年同期。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "碳酸锂价格阶段性企稳但分化仍在",
    url: "https://materials.example.com/lithium-price-stabilizing-2026",
    source: "材料价格监测",
    publishedAt: "2026-03-12",
    html: `
      <html>
        <head><title>碳酸锂价格阶段性企稳但分化仍在</title></head>
        <body>
          <article>
            <p>3月以来碳酸锂现货价格较年初明显收窄波动区间，材料端成本压力边际缓和。</p>
            <p>不过中高端产品订单恢复速度快于低端产品，企业原料采购成本与库存结构出现分化。</p>
            <p>若企业库存周转慢于行业均值，成本改善传导到毛利率的速度仍可能偏慢。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "储能项目招标放量带动磷酸铁锂出货",
    url: "https://energy.example.org/storage-bid-growth-2026",
    source: "新能源政策追踪",
    publishedAt: "2026-03-25",
    html: `
      <html>
        <head><title>储能项目招标放量带动磷酸铁锂出货</title></head>
        <body>
          <article>
            <p>多地储能项目一季度集中招标，带动磷酸铁锂电芯需求提升。</p>
            <p>政策端强调安全标准、交付能力与现金流管理，具备交付优势的企业更容易获取订单。</p>
            <p>投资端普遍关注企业订单兑现率、库存消化速度以及资本开支节奏。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "海外市场竞争加剧考验电池企业盈利质量",
    url: "https://global.example.net/battery-margin-quality-2026",
    source: "全球市场快报",
    publishedAt: "2026-02-28",
    html: `
      <html>
        <head><title>海外市场竞争加剧考验电池企业盈利质量</title></head>
        <body>
          <article>
            <p>海外客户议价更趋谨慎，价格竞争加剧，盈利质量成为筛选标的的重要维度。</p>
            <p>具备现金流韧性、研发壁垒与稳定客户结构的企业，更容易在震荡周期中保持估值溢价。</p>
            <p>若企业负债率抬升且经营现金流转弱，投资侧会提高风险折价。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "锂电池产业链关注库存去化与开工率修复",
    url: "https://research.example.edu/inventory-utilization-2026",
    source: "产业研究院",
    publishedAt: "2026-03-08",
    html: `
      <html>
        <head><title>锂电池产业链关注库存去化与开工率修复</title></head>
        <body>
          <article>
            <p>在需求恢复过程中，库存去化速度决定企业利润修复的斜率。</p>
            <p>开工率改善有助于摊薄制造费用，但若产销错配扩大，经营质量压力会重新显现。</p>
            <p>行业观察建议同步跟踪库存费用、产销率、现金流与政策催化强度。</p>
          </article>
        </body>
      </html>
    `,
  },
];

const financeKeywords = [
  "财报",
  "年报",
  "季报",
  "半年报",
  "研报",
  "公告",
  "上市公司",
  "交易所",
  "证券",
  "业绩",
  "盈利",
  "毛利",
  "营收",
  "收入",
  "现金流",
  "库存",
  "订单",
  "需求",
  "供需",
  "估值",
  "行业",
  "电池",
  "锂电",
  "储能",
  "碳酸锂",
  "新能源",
];

const offTopicKeywords = [
  "hotel",
  "hotels",
  "booking",
  "travel",
  "trip",
  "vacation",
  "tourism",
  "resort",
  "airbnb",
  "flight",
  "map",
  "weather",
  "wiki",
  "百科",
  "招聘",
  "留学",
  "游戏",
];

const officialSourcePatterns = [
  /(?:^|\.)gov\.cn$/i,
  /(?:^|\.)edu\.cn$/i,
  /(?:^|\.)stats\.gov\.cn$/i,
  /(?:^|\.)sse\.com\.cn$/i,
  /(?:^|\.)szse\.cn$/i,
  /(?:^|\.)bse\.cn$/i,
  /(?:^|\.)cninfo\.com\.cn$/i,
];

const financialSourcePatterns = [
  ...officialSourcePatterns,
  /(?:^|\.)eastmoney\.com$/i,
  /(?:^|\.)dfcfw\.com$/i,
  /(?:^|\.)cs\.com\.cn$/i,
  /(?:^|\.)stcn\.com$/i,
  /(?:^|\.)cnstock\.com$/i,
  /(?:^|\.)10jqka\.com\.cn$/i,
  /(?:^|\.)jrj\.com\.cn$/i,
  /(?:^|\.)finance\./i,
  /(?:^|\.)research\./i,
];

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number) {
  return Number(value.toFixed(2));
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function extractTagText(block: string | undefined, tagName: string) {
  if (!block) {
    return "";
  }

  const matched = block.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return matched ? normalizeWhitespace(decodeHtmlEntities(matched[1] ?? "")) : "";
}

function inferSourceFromUrl(url: string) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    return hostname || "网页检索";
  } catch {
    return "网页检索";
  }
}

function resolveSearchLink(url: string) {
  try {
    const parsed = new URL(url);
    const redirectUrl = parsed.searchParams.get("uddg");
    if (redirectUrl) {
      return decodeURIComponent(redirectUrl);
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

function stripHtml(html: string) {
  const bodyOnly = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(p|div|article|section|li|h1|h2|h3|br)>/gi, "\n");

  return normalizeWhitespace(
    decodeHtmlEntities(bodyOnly.replace(/<[^>]+>/g, " ").replace(/\n+/g, "\n")),
  );
}

function tokenize(text: string) {
  const normalized = text.toLowerCase();
  const parts = normalized.match(/[\u4e00-\u9fff]{2,}|[a-z0-9]+/g) ?? [];
  const tokens: string[] = [];

  for (const part of parts) {
    if (/^[\u4e00-\u9fff]+$/.test(part)) {
      tokens.push(part);
      if (part.length === 2) {
        tokens.push(part);
        continue;
      }

      for (let index = 0; index < part.length - 1; index += 1) {
        tokens.push(part.slice(index, index + 2));
      }
      continue;
    }

    if (part.length > 1) {
      tokens.push(part);
    }
  }

  return tokens;
}

function termFrequency(tokens: string[]) {
  const frequency = new Map<string, number>();

  for (const token of tokens) {
    frequency.set(token, (frequency.get(token) ?? 0) + 1);
  }

  return frequency;
}

function cosineSimilarity(
  left: Map<string, number>,
  right: Map<string, number>,
  weights: Map<string, number>,
) {
  let dotProduct = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const [token, count] of left.entries()) {
    const weight = weights.get(token) ?? 1;
    const weighted = count * weight;
    leftNorm += weighted * weighted;
  }

  for (const [token, count] of right.entries()) {
    const weight = weights.get(token) ?? 1;
    const weighted = count * weight;
    rightNorm += weighted * weighted;
  }

  for (const [token, leftCount] of left.entries()) {
    const rightCount = right.get(token);

    if (!rightCount) {
      continue;
    }

    const weight = weights.get(token) ?? 1;
    dotProduct += leftCount * rightCount * weight * weight;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function cleanFinancialText(text: string) {
  return text
    .replace(/\n\s*\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/免责声明[\s\S]*?(?=\n|$)/i, "")
    .trim();
}

function splitFinancialTextIntoChunks(text: string, chunkSize = 300, overlap = 50) {
  const paragraphs = text.split(/\n+/).filter(p => p.trim().length > 0);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + para).length <= chunkSize) {
      current = current ? `${current}\n${para}` : para;
    } else {
      if (current) {
        chunks.push(current);
        const overlapText = current.slice(Math.max(0, current.length - overlap));
        current = `${overlapText}\n${para}`.trim();
      } else {
        const sentences = para.split(/(?<=[。！？.!?])\s+/);
        for (const sentence of sentences) {
          if (!current) {
            current = sentence;
          } else if ((current + sentence).length <= chunkSize) {
            current = `${current} ${sentence}`;
          } else {
            chunks.push(current);
            const overlapText = current.slice(Math.max(0, current.length - overlap));
            current = `${overlapText} ${sentence}`;
          }
        }
      }
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function extractMetadata(text: string): ChunkMetadata {
  const metrics = [];
  if (text.includes("毛利") || text.includes("利润")) metrics.push("profit");
  if (text.includes("营收") || text.includes("收入")) metrics.push("revenue");
  if (text.includes("现金流")) metrics.push("cashflow");
  if (text.includes("库存") || text.includes("去化")) metrics.push("inventory");
  
  const isFinancialData = /\d+(\.\d+)?%|同比|环比|亿元|万元/.test(text);

  return {
    isFinancialData,
    metrics,
    entities: []
  };
}

function computeMetadataScore(chunkMetadata: ChunkMetadata, queryMetadata: ChunkMetadata) {
  let score = 0;
  if (queryMetadata.isFinancialData && chunkMetadata.isFinancialData) {
    score += 0.3;
  }
  const metricOverlap = queryMetadata.metrics.filter(m => chunkMetadata.metrics.includes(m)).length;
  if (queryMetadata.metrics.length > 0) {
    score += (metricOverlap / queryMetadata.metrics.length) * 0.5;
  }
  return score;
}

function extractFinancialInsights(text: string) {
  const insights: string[] = [];
  
  const growthMatch = text.match(/[\u4e00-\u9fa5]{2,6}(?:同比|环比)(?:增长|下降|增加|减少)?[0-9]+(?:\.[0-9]+)?%/g);
  if (growthMatch) {
    insights.push(`指标变动: ${growthMatch.slice(0, 2).join(", ")}`);
  }
  
  const valueMatch = text.match(/[\u4e00-\u9fa5]{2,6}(?:达到|为|约)?[0-9]+(?:\.[0-9]+)?(?:亿|万)?元/g);
  if (valueMatch) {
    insights.push(`财务数据: ${valueMatch.slice(0, 2).join(", ")}`);
  }
  
  return insights;
}

function inferDocumentType(title: string, source: string, text: string, url: string): RagDocumentType {
  const combined = `${title} ${source} ${text} ${url}`.toLowerCase();

  if (/(年度报告|年报|半年报|季报|财报)/.test(combined)) {
    return "financialReport";
  }

  if (/(研报|深度报告|研究|research)/.test(combined)) {
    return "industryReport";
  }

  if (/(统计局|macro|ppi|cpi|工业增加值)/.test(combined)) {
    return "macroData";
  }

  if (/(快报|观察|news|demand|policy|materials|global|energy)/.test(combined)) {
    return "marketNews";
  }

  return "unknown";
}

function extractMatchedTerms(chunkText: string, queryTokens: string[]) {
  return Array.from(
    new Set(
      queryTokens.filter((token) => token.length > 1 && chunkText.toLowerCase().includes(token.toLowerCase())),
    ),
  ).slice(0, 8);
}

function buildIdfWeights(documents: Map<string, number>[]) {
  const documentFrequency = new Map<string, number>();

  for (const document of documents) {
    for (const token of document.keys()) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const weights = new Map<string, number>();
  const totalDocuments = documents.length;

  for (const [token, frequency] of documentFrequency.entries()) {
    weights.set(token, Math.log((totalDocuments + 1) / (frequency + 1)) + 1);
  }

  return weights;
}

function summarizeChunk(chunkText: string, queryTokens: string[]) {
  const sentences = chunkText
    .split(/(?<=[。！？.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  const ranked = sentences
    .map((sentence) => {
      const score = queryTokens.reduce(
        (total, token) => (sentence.includes(token) ? total + 1 : total),
        0,
      );

      return {
        sentence,
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.sentence.length - right.sentence.length);

  const topSentences = ranked
    .filter((item) => item.score > 0)
    .slice(0, 2)
    .map((item) => item.sentence);

  return normalizeWhitespace((topSentences.length > 0 ? topSentences : sentences.slice(0, 2)).join(" "));
}

function computeAuthorityScore(url: string) {
  try {
    const { hostname, protocol } = new URL(url);
    const secureBonus = protocol === "https:" ? 0.05 : 0;

    if (officialSourcePatterns.some((pattern) => pattern.test(hostname))) {
      return clamp(0.95 + secureBonus);
    }

    if (financialSourcePatterns.some((pattern) => pattern.test(hostname))) {
      return clamp(0.88 + secureBonus);
    }

    if (hostname.endsWith(".gov") || hostname.endsWith(".edu")) {
      return clamp(0.9 + secureBonus);
    }

    if (hostname.endsWith(".org")) {
      return clamp(0.8 + secureBonus);
    }

    if (/(research|insight|energy|materials|global)/.test(hostname)) {
      return clamp(0.72 + secureBonus);
    }

    return clamp(0.62 + secureBonus);
  } catch {
    return 0.55;
  }
}

function computeFreshnessScore(publishedAt: string | undefined, now: Date) {
  if (!publishedAt) {
    return 0.55;
  }

  const publishedTime = new Date(publishedAt).getTime();

  if (Number.isNaN(publishedTime)) {
    return 0.55;
  }

  const dayDiff = Math.max(0, (now.getTime() - publishedTime) / (1000 * 60 * 60 * 24));

  if (dayDiff <= 30) {
    return 1;
  }

  if (dayDiff <= 90) {
    return 0.85;
  }

  if (dayDiff <= 180) {
    return 0.7;
  }

  return 0.55;
}

function toConfidence(score: number): CitationConfidence {
  if (score >= 0.76) {
    return "high";
  }

  if (score >= 0.56) {
    return "medium";
  }

  return "low";
}

function composeReferenceAbstract(citations: IndustryCitation[]) {
  return citations.map((item) => `${item.source}：${item.summary}`).join("；");
}

function formatSearchProvider(providerName: string) {
  if (providerName === "bing-rss") {
    return "Bing RSS";
  }

  if (providerName === "curated-battery-fallback") {
    return "内置行业回退源";
  }

  return providerName;
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedSource(url: string, whitelist: string[]) {
  if (whitelist.length === 0) {
    return true;
  }

  const hostname = getHostname(url);
  return whitelist.some((item) => hostname === item || hostname.endsWith(`.${item}`));
}

function containsKeyword(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function countKeywordHits(text: string, keywords: string[]) {
  const normalized = text.toLowerCase();
  return keywords.reduce(
    (total, keyword) => (normalized.includes(keyword.toLowerCase()) ? total + 1 : total),
    0,
  );
}

function matchesSourcePatterns(url: string, patterns: RegExp[]) {
  const hostname = getHostname(url);
  return patterns.some((pattern) => pattern.test(hostname));
}

function scoreSearchHitFinancialRelevance(
  item: WebSearchResult,
  request: RealtimeRagRequest,
  whitelist: string[],
) {
  const combinedText = `${item.title} ${item.snippet} ${item.source} ${item.url}`;
  const financeHits = countKeywordHits(combinedText, financeKeywords);
  const enterpriseTokens = tokenize(`${request.enterpriseName ?? ""} ${request.query}`).filter((token) => token.length > 1);
  const enterpriseOverlap = enterpriseTokens.reduce(
    (total, token) => (combinedText.toLowerCase().includes(token.toLowerCase()) ? total + 1 : total),
    0,
  );
  const officialBonus = matchesSourcePatterns(item.url, officialSourcePatterns) ? 0.25 : 0;
  const financialBonus = matchesSourcePatterns(item.url, financialSourcePatterns) ? 0.18 : 0;
  const whitelistBonus = isAllowedSource(item.url, whitelist) ? 0.1 : 0;
  const offTopicPenalty = containsKeyword(combinedText, offTopicKeywords) ? 0.45 : 0;

  return clamp(
    item.rankScore * 0.35 +
      Math.min(0.25, financeHits * 0.05) +
      Math.min(0.18, enterpriseOverlap * 0.06) +
      officialBonus +
      financialBonus +
      whitelistBonus -
      offTopicPenalty,
  );
}

function isRelevantFinancialSearchHit(
  item: WebSearchResult,
  request: RealtimeRagRequest,
  whitelist: string[],
) {
  const combinedText = `${item.title} ${item.snippet} ${item.source} ${item.url}`;
  const financeHit = containsKeyword(combinedText, financeKeywords);
  const offTopicHit = containsKeyword(combinedText, offTopicKeywords);
  const strongSource = matchesSourcePatterns(item.url, financialSourcePatterns) || isAllowedSource(item.url, whitelist);
  const enterpriseTokens = tokenize(`${request.enterpriseName ?? ""} ${request.query}`).filter((token) => token.length > 1);
  const enterpriseOverlap = enterpriseTokens.some((token) => combinedText.toLowerCase().includes(token.toLowerCase()));
  const score = scoreSearchHitFinancialRelevance(item, request, whitelist);

  if (offTopicHit && !financeHit && !strongSource) {
    return false;
  }

  if (strongSource && score >= 0.35) {
    return true;
  }

  return score >= 0.4 && (financeHit || enterpriseOverlap);
}

function isFreshEnough(publishedAt: string | undefined, now: Date, maxAgeDays: number) {
  if (!publishedAt) {
    return true;
  }

  const publishedTime = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedTime)) {
    return true;
  }

  return now.getTime() - publishedTime <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function buildRetrievalSummary(
  request: RealtimeRagRequest,
  citations: IndustryCitation[],
  searchProvider: string,
  fallbackUsed: boolean,
) {
  const providerText = formatSearchProvider(searchProvider);
  if (citations.length === 0) {
    return `未检索到可引用的网页证据，当前建议以结构化行业输入和数学模型结果为主。检索通道：${providerText}${fallbackUsed ? "（已启用回退）" : ""}。`;
  }

  const focusText =
    request.role === "enterprise"
      ? "经营侧需关注需求恢复、库存去化与成本传导"
      : "投资侧需关注需求兑现、现金流质量与估值折价因子";

  return `${focusText}。已通过${providerText}${fallbackUsed ? "（含回退）" : ""}检索 ${citations.length} 条高相关引用，其中最高可信度为 ${citations[0]?.confidence}。`;
}

function buildSearchSnippet(page: CuratedPage) {
  return stripHtml(page.html).slice(0, 120);
}

export class CuratedBatteryWebSearchProvider implements WebSearchProvider {
  async search(request: { query: string; limit: number }) {
    const queryTokens = tokenize(request.query);
    const queryFrequency = termFrequency(queryTokens);

    const scored = curatedPages
      .map((page) => {
        const searchableText = `${page.title} ${buildSearchSnippet(page)} ${stripHtml(page.html)}`;
        const documentTokens = tokenize(searchableText);
        const documentFrequency = termFrequency(documentTokens);
        const overlap = queryTokens.reduce(
          (total, token) => (documentFrequency.has(token) ? total + 1 : total),
          0,
        );
        const score =
          cosineSimilarity(queryFrequency, documentFrequency, buildIdfWeights([queryFrequency, documentFrequency])) *
            0.8 +
          Math.min(1, overlap / Math.max(1, queryTokens.length)) * 0.2;

        return {
          title: page.title,
          url: page.url,
          snippet: buildSearchSnippet(page),
          source: page.source,
          publishedAt: page.publishedAt,
          rankScore: clamp(score),
        } satisfies WebSearchResult;
      })
      .sort((left, right) => right.rankScore - left.rankScore);

    return {
      items: scored.slice(0, request.limit),
      providerName: "curated-battery-fallback",
      fallbackUsed: true,
    } satisfies WebSearchResponse;
  }
}

export class BingWebSearchProvider implements WebSearchProvider {
  async search(request: { query: string; limit: number }) {
    const response = await fetch(
      `https://www.bing.com/search?format=rss&setlang=zh-Hans&mkt=zh-CN&q=${encodeURIComponent(request.query)}`,
      {
        headers: {
          accept: "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!response.ok) {
      throw new Error(`bing search failed: ${response.status}`);
    }

    const xml = await response.text();
    const queryTokens = tokenize(request.query);
    const queryFrequency = termFrequency(queryTokens);
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi))
      .map((match, index) => {
        const block = match[1] ?? "";
        const title = extractTagText(block, "title");
        const url = resolveSearchLink(extractTagText(block, "link"));
        const snippet = extractTagText(block, "description");
        const publishedAt = extractTagText(block, "pubDate");
        const documentFrequency = termFrequency(tokenize(`${title} ${snippet}`));
        const overlap = queryTokens.reduce(
          (total, token) => (documentFrequency.has(token) ? total + 1 : total),
          0,
        );
        const lexicalScore = cosineSimilarity(
          queryFrequency,
          documentFrequency,
          buildIdfWeights([queryFrequency, documentFrequency]),
        );
        const rankScore = clamp(
          lexicalScore * 0.65 +
            Math.min(1, overlap / Math.max(1, queryTokens.length)) * 0.2 +
            Math.max(0.2, 1 - index * 0.12) * 0.15,
        );

        return {
          title,
          url,
          snippet,
          source: inferSourceFromUrl(url),
          publishedAt: publishedAt || undefined,
          rankScore,
        } satisfies WebSearchResult;
      })
      .filter((item) => item.title && item.url)
      .slice(0, request.limit);

    return {
      items,
      providerName: "bing-rss",
      fallbackUsed: false,
    } satisfies WebSearchResponse;
  }
}

export class InMemoryWebPageFetcher implements WebPageFetcher {
  async fetch(result: WebSearchResult) {
    const page = curatedPages.find((item) => item.url === result.url);

    if (!page) {
      return {
        title: result.title,
        url: result.url,
        source: result.source,
        publishedAt: result.publishedAt,
        html: `<html><body><article><p>${result.snippet}</p></article></body></html>`,
      } satisfies WebPageResult;
    }

    return {
      title: page.title,
      url: page.url,
      source: page.source,
      publishedAt: page.publishedAt,
      html: page.html,
    } satisfies WebPageResult;
  }
}

export class HttpWebPageFetcher implements WebPageFetcher {
  async fetch(result: WebSearchResult) {
    const parsedUrl = new URL(result.url);

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error(`unsupported protocol: ${parsedUrl.protocol}`);
    }

    const response = await fetch(parsedUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) {
      throw new Error(`page fetch failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error(`unsupported content type: ${contentType}`);
    }

    const html = (await response.text()).slice(0, 250_000);

    return {
      title: result.title,
      url: result.url,
      source: result.source,
      publishedAt: result.publishedAt,
      html,
    } satisfies WebPageResult;
  }
}

export class RealtimeIndustryRagService {
  private readonly searchProvider: WebSearchProvider;

  private readonly fallbackSearchProvider: WebSearchProvider;

  private readonly pageFetcher: WebPageFetcher;

  private readonly fallbackPageFetcher: WebPageFetcher;

  private readonly now: () => Date;

  private readonly cacheTtlMs: number;

  private readonly sourceWhitelist: string[];

  private readonly maxSourceAgeDays: number;

  private readonly cache = new Map<string, CachedResponse>();
  private readonly maxCacheSize = 200;

  constructor(dependencies: RagDependencies = {}) {
    this.searchProvider = dependencies.searchProvider ?? new BingWebSearchProvider();
    this.fallbackSearchProvider =
      dependencies.fallbackSearchProvider ?? new CuratedBatteryWebSearchProvider();
    this.pageFetcher = dependencies.pageFetcher ?? new HttpWebPageFetcher();
    this.fallbackPageFetcher = dependencies.fallbackPageFetcher ?? new InMemoryWebPageFetcher();
    this.now = dependencies.now ?? (() => new Date());
    this.cacheTtlMs = dependencies.cacheTtlMs ?? 300_000;
    this.sourceWhitelist = (dependencies.sourceWhitelist ?? []).map((item) => item.toLowerCase());
    this.maxSourceAgeDays = dependencies.maxSourceAgeDays ?? 60;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async retrieve(request: RealtimeRagRequest): Promise<RealtimeRagResponse> {
    const searchQuery = this.composeQuery(request);
    const cacheKey = JSON.stringify({
      role: request.role,
      enterpriseName: request.enterpriseName,
      query: searchQuery,
      focusMode: request.focusMode,
      limit: request.limit,
    });
    const cached = this.cache.get(cacheKey);
    const now = this.now();

    if (cached && now.getTime() - cached.storedAt <= this.cacheTtlMs) {
      return {
        ...cached.response,
        indexStats: {
          ...cached.response.indexStats,
          cacheHit: true,
        },
      };
    }

    if (cached) {
      this.cache.delete(cacheKey);
    }

    const searchResponse = await this.resolveSearchResults({
      query: searchQuery,
      limit: Math.max(request.limit + 1, 4),
    });
    const uniqueSearchHits = searchResponse.items.filter(
      (item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index,
    );
    let filteredOutCount = 0;
    let searchHits = uniqueSearchHits
      .filter((item) => {
        const keep = isRelevantFinancialSearchHit(item, request, this.sourceWhitelist);
        if (!keep) {
          filteredOutCount += 1;
        }
        return keep;
      })
      .sort(
        (left, right) =>
          scoreSearchHitFinancialRelevance(right, request, this.sourceWhitelist) -
          scoreSearchHitFinancialRelevance(left, request, this.sourceWhitelist),
      );

    let effectiveSearchResponse = searchResponse;
    if (searchHits.length === 0 && !searchResponse.fallbackUsed) {
      const fallbackResponse = await this.fallbackSearchProvider.search({
        query: searchQuery,
        limit: Math.max(request.limit + 1, 4),
      });
      effectiveSearchResponse = {
        items: fallbackResponse.items,
        providerName: fallbackResponse.providerName,
        fallbackUsed: true,
      };
      const dedupedFallbackHits = fallbackResponse.items.filter(
        (item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index,
      );
      searchHits = dedupedFallbackHits
        .filter((item) => isRelevantFinancialSearchHit(item, request, this.sourceWhitelist))
        .sort(
          (left, right) =>
            scoreSearchHitFinancialRelevance(right, request, this.sourceWhitelist) -
            scoreSearchHitFinancialRelevance(left, request, this.sourceWhitelist),
        );
      filteredOutCount += dedupedFallbackHits.length - searchHits.length;
    }

    const pageFetchResult = await this.fetchPages(searchHits);
    const fetchedPages = pageFetchResult.items;

    const queryTokens = tokenize(searchQuery);
    const queryFrequency = termFrequency(queryTokens);
    const queryMetadata = extractMetadata(searchQuery);

    const chunkFrequencies: Map<string, number>[] = [];
    const chunks: Array<IndexedChunk> = [];

    for (const { hit, page } of fetchedPages) {
      const cleanedText = cleanFinancialText(stripHtml(page.html));
      const splitChunks = splitFinancialTextIntoChunks(cleanedText);

      splitChunks.forEach((chunkText, chunkIndex) => {
        const frequency = termFrequency(tokenize(chunkText));
        chunkFrequencies.push(frequency);
        chunks.push({
          documentId: createHash("sha1").update(hit.url).digest("hex").slice(0, 12),
          documentKey: hit.url,
          documentType: inferDocumentType(page.title || hit.title, hit.source, chunkText, hit.url),
          title: page.title || hit.title,
          url: hit.url,
          source: hit.source,
          publishedAt: hit.publishedAt,
          chunkIndex,
          chunkLength: chunkText.length,
          contentHash: createHash("sha1").update(chunkText).digest("hex").slice(0, 16),
          chunkText,
          metadata: extractMetadata(chunkText),
          lexicalScore: 0,
          metadataScore: 0,
          authorityScore: 0,
          freshnessScore: 0,
          searchRankScore: hit.rankScore,
          relevanceScore: 0,
          confidenceScore: 0,
          confidence: "low",
        });
      });
    }

    const staleFilteredChunks = chunks.filter(
      (chunk) => !isFreshEnough(chunk.publishedAt, now, this.maxSourceAgeDays),
    ).length;
    const candidateChunks = chunks.filter((chunk) =>
      isFreshEnough(chunk.publishedAt, now, this.maxSourceAgeDays),
    );

    const weights = buildIdfWeights([queryFrequency, ...chunkFrequencies]);

    candidateChunks.forEach((chunk) => {
      const frequency = termFrequency(tokenize(chunk.chunkText));
      const searchHit = searchHits.find((item) => item.url === chunk.url);
      const lexicalScore = cosineSimilarity(queryFrequency, frequency, weights);
      const metadataScore = computeMetadataScore(chunk.metadata, queryMetadata);

      const authorityScore = computeAuthorityScore(chunk.url);
      const freshnessScore = computeFreshnessScore(chunk.publishedAt, now);
      const relevanceScore = clamp(
        lexicalScore * 0.6 + metadataScore * 0.2 + (searchHit?.rankScore ?? 0) * 0.2,
      );
      const confidenceScore = clamp(
        relevanceScore * 0.55 + authorityScore * 0.25 + freshnessScore * 0.2,
      );

      chunk.lexicalScore = lexicalScore;
      chunk.metadataScore = metadataScore;
      chunk.authorityScore = authorityScore;
      chunk.freshnessScore = freshnessScore;
      chunk.searchRankScore = searchHit?.rankScore ?? 0;
      chunk.relevanceScore = relevanceScore;
      chunk.confidenceScore = confidenceScore;
      chunk.confidence = toConfidence(confidenceScore);
    });

    const topByDocument = new Map<string, IndexedChunk>();

    for (const chunk of candidateChunks.sort(
      (left, right) => right.confidenceScore - left.confidenceScore,
    )) {
      const existing = topByDocument.get(chunk.url);

      if (!existing || existing.confidenceScore < chunk.confidenceScore) {
        topByDocument.set(chunk.url, chunk);
      }
    }

    const citations = Array.from(topByDocument.values())
      .sort((left, right) => right.confidenceScore - left.confidenceScore)
      .slice(0, request.limit)
      .map((chunk) =>
        this.buildCitation(
          chunk,
          queryTokens,
          now,
          effectiveSearchResponse.providerName,
          effectiveSearchResponse.fallbackUsed || pageFetchResult.fallbackUsed,
        ),
      );

    const documentTypes = Array.from(new Set(citations.map((item) => item.trace.documentType)));

    const indexStats: RealtimeRagIndexStats = {
      searchHits: searchHits.length,
      fetchedPages: fetchedPages.length,
      chunkCount: candidateChunks.length,
      rankedChunks: candidateChunks.filter((item) => item.relevanceScore > 0).length,
      searchProvider: effectiveSearchResponse.providerName,
      fallbackUsed: effectiveSearchResponse.fallbackUsed || pageFetchResult.fallbackUsed,
      cacheHit: false,
      filteredSources: filteredOutCount,
      staleFiltered: staleFilteredChunks,
      traceableCitations: citations.filter((item) => Boolean(item.trace)).length,
      traceableDocuments: new Set(citations.map((item) => item.trace.documentId)).size,
      documentTypes,
      conflictWarnings:
        staleFilteredChunks > 0
          ? [`已过滤 ${staleFilteredChunks} 个超出时效窗口的分片。`]
          : [],
    };

    const response = {
      role: request.role,
      focusMode: request.focusMode,
      query: searchQuery,
      retrievalSummary: buildRetrievalSummary(
        request,
        citations,
        indexStats.searchProvider,
        indexStats.fallbackUsed,
      ),
      referenceAbstract: composeReferenceAbstract(citations),
      citations,
      indexStats,
    };

    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    this.cache.set(cacheKey, {
      storedAt: now.getTime(),
      response,
    });

    return response;
  }

  private async resolveSearchResults(request: { query: string; limit: number }) {
    try {
      const response = await this.searchProvider.search(request);
      if (response.items.length > 0) {
        return response;
      }
    } catch {
      return this.fallbackSearchProvider.search(request);
    }

    return this.fallbackSearchProvider.search(request);
  }

  private async fetchPages(searchHits: WebSearchResult[]) {
    let fallbackUsed = false;
    const items = await Promise.all(
      searchHits.map(async (hit) => {
        try {
          return {
            hit,
            page: await this.pageFetcher.fetch(hit),
          };
        } catch {
          fallbackUsed = true;
          return {
            hit,
            page: await this.fallbackPageFetcher.fetch(hit),
          };
        }
      }),
    );

    return {
      items,
      fallbackUsed,
    };
  }

  private composeQuery(request: RealtimeRagRequest) {
    const roleFocus =
      request.role === "enterprise"
        ? "锂电池 企业经营 毛利 成本 库存 订单 现金流 财报 研报 公告 官方 金融"
        : "锂电池 投资 行业需求 竞争格局 现金流 估值 政策 财报 研报 公告 官方 金融";

    const modeFocus =
      request.focusMode === "investmentRecommendation"
        ? "投资推荐 风险收益"
        : request.focusMode === "deepDive"
          ? "深度解析 证据引用"
          : request.focusMode === "industryStatus"
            ? "行业景气 供需变化"
            : "经营诊断 经营质量";

    const interestSuffix = (request.userInterests?.length ?? 0) > 0
      ? ` ${request.userInterests!.slice(0, 3).join(" ")}`
      : "";

    return normalizeWhitespace(
      [
        request.enterpriseName,
        request.query,
        roleFocus,
        modeFocus,
        "上市公司 交易所 证券",
        "-hotel -booking -travel -trip",
      ].filter(Boolean).join(" ") + interestSuffix,
    );
  }

  private buildCitation(
    chunk: IndexedChunk,
    queryTokens: string[],
    now: Date,
    searchProvider: string,
    fallbackUsed: boolean,
  ): IndustryCitation {
    const summaryText = summarizeChunk(chunk.chunkText, queryTokens);
    const insights = extractFinancialInsights(chunk.chunkText);
    
    const formattedSummary = insights.length > 0 
      ? `${summaryText} 【关键信息提取：${insights.join(" | ")}】`
      : summaryText;

    const excerpt = chunk.chunkText.slice(0, 140);
    const id = createHash("sha1").update(`${chunk.url}|${excerpt}`).digest("hex").slice(0, 12);
    const matchedTerms = extractMatchedTerms(chunk.chunkText, queryTokens);

    return {
      id,
      title: chunk.title,
      url: chunk.url,
      source: chunk.source,
      summary: formattedSummary,
      excerpt,
      confidence: chunk.confidence,
      confidenceScore: roundScore(chunk.confidenceScore),
      relevanceScore: roundScore(chunk.relevanceScore),
      publishedAt: chunk.publishedAt,
      retrievedAt: now.toISOString(),
      trace: {
        documentId: chunk.documentId,
        documentType: chunk.documentType,
        chunkId: `${chunk.documentId}-${chunk.chunkIndex}`,
        chunkIndex: chunk.chunkIndex,
        chunkLength: chunk.chunkLength,
        contentHash: chunk.contentHash,
        matchedMetrics: chunk.metadata.metrics,
        matchedTerms,
        searchProvider,
        fallbackUsed,
        rankingSignals: {
          lexicalScore: roundScore(chunk.lexicalScore),
          metadataScore: roundScore(chunk.metadataScore),
          authorityScore: roundScore(chunk.authorityScore),
          freshnessScore: roundScore(chunk.freshnessScore),
          searchRankScore: roundScore(chunk.searchRankScore),
          relevanceScore: roundScore(chunk.relevanceScore),
          confidenceScore: roundScore(chunk.confidenceScore),
        },
      },
    } satisfies IndustryCitation;
  }
}

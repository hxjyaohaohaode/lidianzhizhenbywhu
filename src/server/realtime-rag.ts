import { createHash } from "node:crypto";

import type { CitationConfidence, IndustryCitation, RagDocumentType } from "../shared/agents.js";
import type { RealtimeRagIndexStats, RealtimeRagRequest, RealtimeRagResponse } from "../shared/rag.js";
import type { ModelRouter } from "./llm.js";

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
  platformStore?: PlatformStoreLike;
  modelRouter?: ModelRouter;
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
    title: "上海有色网碳酸锂价格行情",
    url: "https://www.smm.cn/lithium",
    source: "上海有色网",
    publishedAt: "2026-04-10",
    html: `
      <html>
        <head><title>上海有色网碳酸锂价格行情</title></head>
        <body>
          <article>
            <h1>上海有色网碳酸锂价格行情</h1>
            <p>碳酸锂现货价格近期波动区间收窄，材料端成本压力边际缓和，电池企业原料采购成本出现分化。</p>
            <p>中高端产品订单恢复速度快于低端产品，若企业库存周转慢于行业均值，成本改善传导到毛利率的速度仍可能偏慢。</p>
            <p>结合上市公司年报和季报数据，上海有色网持续跟踪碳酸锂及正极材料价格走势，为产业链企业提供实时报价与趋势分析。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "高工锂电行业研报：储能与动力电池需求共振",
    url: "https://www.gg-lb.com/art-47988.html",
    source: "高工锂电",
    publishedAt: "2026-03-26",
    html: `
      <html>
        <head><title>高工锂电行业研报：储能与动力电池需求共振</title></head>
        <body>
          <article>
            <h1>高工锂电行业研报：储能与动力电池需求共振</h1>
            <p>研报指出，行业库存去化进入后半程，储能招标放量带动二季度订单前瞻改善。</p>
            <p>若企业现金流质量同步改善，盈利修复斜率通常快于仅依赖价格反弹的企业。</p>
            <p>建议重点跟踪出货兑现率、库存费用、经营现金流和政策节奏。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "中国化学与物理电源行业协会行业数据",
    url: "https://www.ciaps.org.cn/news/",
    source: "中国化学与物理电源行业协会",
    publishedAt: "2026-04-02",
    html: `
      <html>
        <head><title>中国化学与物理电源行业协会行业数据</title></head>
        <body>
          <article>
            <h1>中国化学与物理电源行业协会行业数据</h1>
            <p>协会发布最新行业运行数据，2026年一季度动力电池与储能电池出货量同比继续增长。</p>
            <p>头部企业排产保持高位，行业整体开工率环比改善，但中小企业仍面临价格竞争压力。</p>
            <p>协会建议关注企业产品结构优化、库存消化速度以及经营现金流质量变化。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "中证新能源电池指数行情",
    url: "https://quote.eastmoney.com/zs931992.html",
    source: "东方财富",
    publishedAt: "2026-04-11",
    html: `
      <html>
        <head><title>中证新能源电池指数行情</title></head>
        <body>
          <article>
            <h1>中证新能源电池指数行情</h1>
            <p>中证新能源电池指数近期走势反映市场对锂电池产业链盈利修复节奏的预期分化。</p>
            <p>具备现金流韧性、研发壁垒与稳定客户结构的企业，更容易在震荡周期中保持估值溢价。</p>
            <p>投资端普遍关注企业订单兑现率、库存消化速度以及资本开支节奏对盈利质量的影响。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "国家统计局工业增加值数据",
    url: "https://data.stats.gov.cn/easyquery.htm",
    source: "国家统计局",
    publishedAt: "2026-03-15",
    html: `
      <html>
        <head><title>国家统计局工业增加值数据</title></head>
        <body>
          <article>
            <h1>国家统计局工业增加值数据</h1>
            <p>2026年1-2月规模以上工业增加值同比增长，制造业景气度延续恢复态势。</p>
            <p>电气机械和器材制造业增速领先，新能源相关产业链生产活动保持活跃。</p>
            <p>宏观层面工业生产恢复为锂电池行业需求端提供支撑，但企业间盈利质量分化仍在扩大。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "锂电池产业链库存与开工率跟踪",
    url: "https://www.gg-lb.com/art-48015.html",
    source: "高工锂电",
    publishedAt: "2026-03-08",
    html: `
      <html>
        <head><title>锂电池产业链库存与开工率跟踪</title></head>
        <body>
          <article>
            <h1>锂电池产业链库存与开工率跟踪</h1>
            <p>在需求恢复过程中，库存去化速度决定企业利润修复的斜率。</p>
            <p>开工率改善有助于摊薄制造费用，但若产销错配扩大，经营质量压力会重新显现。</p>
            <p>行业观察建议同步跟踪库存费用、产销率、现金流与政策催化强度。</p>
          </article>
        </body>
      </html>
    `,
  },
  {
    title: "储能项目招标与磷酸铁锂出货跟踪",
    url: "https://www.ciaps.org.cn/news/2026/",
    source: "中国化学与物理电源行业协会",
    publishedAt: "2026-03-25",
    html: `
      <html>
        <head><title>储能项目招标与磷酸铁锂出货跟踪</title></head>
        <body>
          <article>
            <h1>储能项目招标与磷酸铁锂出货跟踪</h1>
            <p>多地储能项目一季度集中招标，带动磷酸铁锂电芯需求提升。</p>
            <p>政策端强调安全标准、交付能力与现金流管理，具备交付优势的企业更容易获取订单。</p>
            <p>投资端普遍关注企业订单兑现率、库存消化速度以及资本开支节奏。</p>
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
  /(?:^|\.)smm\.cn$/i,
  /(?:^|\.)gg-lb\.com$/i,
  /(?:^|\.)ciaps\.org\.cn$/i,
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

type PlatformStoreLike = {
  listIndustryData(limit?: number): Array<{
    recordId: string;
    dataDate: string;
    lithiumPrice: {
      priceDate: string;
      price: number;
      source: string;
    };
    industryIndex?: {
      indexDate: string;
      indexType: string;
      indexValue: number;
      volatility: number;
    };
    createdAt: string;
  }>;
};

export class CuratedBatteryWebSearchProvider implements WebSearchProvider {
  private readonly platformStore?: PlatformStoreLike;

  constructor(platformStore?: PlatformStoreLike) {
    this.platformStore = platformStore;
  }

  async search(request: { query: string; limit: number }) {
    const queryTokens = tokenize(request.query);
    const queryFrequency = termFrequency(queryTokens);

    const allPages = [...curatedPages];

    if (this.platformStore) {
      const industryRecords = this.platformStore.listIndustryData();
      for (const record of industryRecords) {
        const title = `${record.lithiumPrice.source}碳酸锂价格数据 ${record.dataDate}`;
        const url = `platform-store://industry-data/${record.recordId}`;
        const priceText = `碳酸锂价格${record.lithiumPrice.price}元/吨，数据日期${record.lithiumPrice.priceDate}，来源${record.lithiumPrice.source}`;
        const indexText = record.industryIndex
          ? `${record.industryIndex.indexType}指数${record.industryIndex.indexValue}，波动率${record.industryIndex.volatility}`
          : "";
        const html = `<html><body><article><h1>${title}</h1><p>${priceText}</p>${indexText ? `<p>${indexText}</p>` : ""}</article></body></html>`;
        allPages.push({
          title,
          url,
          source: record.lithiumPrice.source,
          publishedAt: record.dataDate,
          html,
        });
      }
    }

    const scored = allPages
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
  private readonly platformStore?: PlatformStoreLike;

  constructor(platformStore?: PlatformStoreLike) {
    this.platformStore = platformStore;
  }

  async fetch(result: WebSearchResult) {
    const page = curatedPages.find((item) => item.url === result.url);

    if (page) {
      return {
        title: page.title,
        url: page.url,
        source: page.source,
        publishedAt: page.publishedAt,
        html: page.html,
      } satisfies WebPageResult;
    }

    if (this.platformStore && result.url.startsWith("platform-store://industry-data/")) {
      const recordId = result.url.replace("platform-store://industry-data/", "");
      const records = this.platformStore.listIndustryData();
      const record = records.find((r) => r.recordId === recordId);
      if (record) {
        const priceText = `碳酸锂价格${record.lithiumPrice.price}元/吨，数据日期${record.lithiumPrice.priceDate}，来源${record.lithiumPrice.source}`;
        const indexText = record.industryIndex
          ? `${record.industryIndex.indexType}指数${record.industryIndex.indexValue}，波动率${record.industryIndex.volatility}`
          : "";
        const html = `<html><body><article><h1>${result.title}</h1><p>${priceText}</p>${indexText ? `<p>${indexText}</p>` : ""}</article></body></html>`;
        return {
          title: result.title,
          url: result.url,
          source: result.source,
          publishedAt: result.publishedAt,
          html,
        } satisfies WebPageResult;
      }
    }

    return {
      title: result.title,
      url: result.url,
      source: result.source,
      publishedAt: result.publishedAt,
      html: `<html><body><article><p>${result.snippet}</p></article></body></html>`,
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

  private readonly modelRouter?: ModelRouter;

  private readonly now: () => Date;

  private readonly cacheTtlMs: number;

  private readonly sourceWhitelist: string[];

  private readonly maxSourceAgeDays: number;

  private readonly cache = new Map<string, CachedResponse>();
  private readonly maxCacheSize = 200;

  constructor(dependencies: RagDependencies = {}) {
    this.searchProvider = dependencies.searchProvider ?? new BingWebSearchProvider();
    this.fallbackSearchProvider =
      dependencies.fallbackSearchProvider ?? new CuratedBatteryWebSearchProvider(dependencies.platformStore);
    this.pageFetcher = dependencies.pageFetcher ?? new HttpWebPageFetcher();
    this.fallbackPageFetcher = dependencies.fallbackPageFetcher ?? new InMemoryWebPageFetcher(dependencies.platformStore);
    this.modelRouter = dependencies.modelRouter;
    this.now = dependencies.now ?? (() => new Date());
    this.cacheTtlMs = dependencies.cacheTtlMs ?? 300_000;
    this.sourceWhitelist = (dependencies.sourceWhitelist ?? []).map((item) => item.toLowerCase());
    this.maxSourceAgeDays = dependencies.maxSourceAgeDays ?? 60;
  }

  clearCache(): void {
    this.cache.clear();
  }

  async retrieve(request: RealtimeRagRequest): Promise<RealtimeRagResponse> {
    const now = this.now();
    
    const queryUnderstanding = await this.understandQueryWithLLM(request);
    const expandedQuery = queryUnderstanding?.expandedTerms.length
      ? `${request.query} ${queryUnderstanding.expandedTerms.slice(0, 3).join(" ")}`
      : request.query;
    
    const searchQuery = this.composeQuery({ ...request, query: expandedQuery });
    const cacheKey = JSON.stringify({
      role: request.role,
      enterpriseName: request.enterpriseName,
      query: searchQuery,
      focusMode: request.focusMode,
      limit: request.limit,
    });
    const cached = this.cache.get(cacheKey);

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

    const rerankedCitations = await this.rerankCitationsWithLLM(citations, request);
    const evidenceEvaluation = await this.evaluateEvidenceWithLLM(rerankedCitations, request);

    const documentTypes = Array.from(new Set(rerankedCitations.map((item) => item.trace.documentType)));

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
      traceableCitations: rerankedCitations.filter((item) => Boolean(item.trace)).length,
      traceableDocuments: new Set(rerankedCitations.map((item) => item.trace.documentId)).size,
      documentTypes,
      conflictWarnings:
        staleFilteredChunks > 0
          ? [`已过滤 ${staleFilteredChunks} 个超出时效窗口的分片。`]
          : [],
    };

    const enhancedRetrievalSummary = `${buildRetrievalSummary(
      request,
      rerankedCitations,
      indexStats.searchProvider,
      indexStats.fallbackUsed,
    )}${queryUnderstanding ? ` [LLM查询理解: ${queryUnderstanding.intent}]` : ""}${evidenceEvaluation.evidenceQuality !== "partial" ? ` [证据质量: ${evidenceEvaluation.evidenceQuality === "sufficient" ? "充分" : "不足"}]` : ""}`;

    const response = {
      role: request.role,
      focusMode: request.focusMode,
      query: searchQuery,
      retrievalSummary: enhancedRetrievalSummary,
      referenceAbstract: composeReferenceAbstract(rerankedCitations),
      citations: rerankedCitations,
      indexStats,
      evidenceEvaluation,
      queryUnderstanding: queryUnderstanding ? {
        intent: queryUnderstanding.intent,
        entities: queryUnderstanding.entities,
        queryType: queryUnderstanding.queryType,
      } : undefined,
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

  private async understandQueryWithLLM(request: RealtimeRagRequest): Promise<{
    intent: string;
    entities: string[];
    expandedTerms: string[];
    queryType: string;
  } | null> {
    if (!this.modelRouter) return null;
    
    try {
      const result = await this.modelRouter.complete({
        agentId: "industryRetrieval",
        capability: "queryUnderstanding",
        prompt: `分析以下查询的意图，提取关键实体，并生成扩展查询词。

用户查询: ${request.query}
企业名称: ${request.enterpriseName || "未指定"}
角色: ${request.role === "enterprise" ? "企业端" : "投资端"}
分析模式: ${request.focusMode}

请以JSON格式输出：
{
  "intent": "查询意图描述",
  "entities": ["提取的实体1", "提取的实体2"],
  "expandedTerms": ["扩展词1", "扩展词2", "扩展词3"],
  "queryType": "diagnosis|comparison|trend|investment|general"
}`,
        context: { query: request.query, role: request.role, focusMode: request.focusMode, enterpriseName: request.enterpriseName },
      });

      const parsed = JSON.parse(result.result.text);
      return {
        intent: String(parsed.intent || ""),
        entities: Array.isArray(parsed.entities) ? parsed.entities.map(String) : [],
        expandedTerms: Array.isArray(parsed.expandedTerms) ? parsed.expandedTerms.map(String) : [],
        queryType: String(parsed.queryType || "general"),
      };
    } catch {
      return null;
    }
  }

  private async rerankCitationsWithLLM(
    citations: IndustryCitation[],
    request: RealtimeRagRequest,
  ): Promise<IndustryCitation[]> {
    if (!this.modelRouter || citations.length <= 1) return citations;

    try {
      const citationsInfo = citations.slice(0, 8).map((c, i) => ({
        index: i,
        title: c.title,
        source: c.source,
        summary: c.summary.slice(0, 200),
        relevanceScore: c.relevanceScore,
      }));

      const result = await this.modelRouter.complete({
        agentId: "industryRetrieval",
        capability: "reranking",
        prompt: `根据查询意图对以下检索结果进行重排序。

用户查询: ${request.query}
企业名称: ${request.enterpriseName || "未指定"}

检索结果:
${JSON.stringify(citationsInfo, null, 2)}

请以JSON格式输出重排序后的索引数组和每个结果的相关性评分：
{
  "rankedIndices": [2, 0, 3, 1, ...],
  "scores": [0.95, 0.85, 0.75, 0.65, ...],
  "reasoning": "重排序理由简述"
}`,
        context: { query: request.query, citations: citationsInfo },
      });

      const parsed = JSON.parse(result.result.text);
      if (!Array.isArray(parsed.rankedIndices)) return citations;

      const rankedIndices = parsed.rankedIndices as number[];
      const scores = (Array.isArray(parsed.scores) ? parsed.scores : []) as number[];

      const reranked: IndustryCitation[] = [];
      for (let newIdx = 0; newIdx < rankedIndices.length; newIdx++) {
        const idx = rankedIndices[newIdx];
        if (typeof idx !== "number" || idx < 0 || idx >= citations.length) continue;
        const citation = citations[idx];
        if (!citation) continue;
        const scoreValue = scores[newIdx];
        const newScore = typeof scoreValue === "number" ? scoreValue : citation.relevanceScore;
        reranked.push({
          ...citation,
          relevanceScore: newScore,
          confidenceScore: newScore,
          confidence: newScore >= 0.76 ? "high" as const : newScore >= 0.56 ? "medium" as const : "low" as const,
        });
      }
      return reranked.length > 0 ? reranked : citations;
    } catch {
      return citations;
    }
  }

  private async evaluateEvidenceWithLLM(
    citations: IndustryCitation[],
    request: RealtimeRagRequest,
  ): Promise<{
    evidenceQuality: "sufficient" | "partial" | "insufficient";
    gaps: string[];
    recommendations: string[];
  }> {
    if (!this.modelRouter || citations.length === 0) {
      return {
        evidenceQuality: "insufficient",
        gaps: ["无法获取LLM服务或无检索结果"],
        recommendations: ["请检查网络连接或稍后重试"],
      };
    }

    try {
      const citationsInfo = citations.slice(0, 5).map((c) => ({
        title: c.title,
        source: c.source,
        summary: c.summary.slice(0, 150),
        confidence: c.confidence,
      }));

      const result = await this.modelRouter.complete({
        agentId: "evidenceReview",
        capability: "evidenceEvaluation",
        prompt: `评估以下证据是否足以支撑诊断结论。

用户查询: ${request.query}
企业名称: ${request.enterpriseName || "未指定"}
分析模式: ${request.focusMode}

可用证据:
${JSON.stringify(citationsInfo, null, 2)}

请以JSON格式输出：
{
  "evidenceQuality": "sufficient|partial|insufficient",
  "gaps": ["证据缺口1", "证据缺口2"],
  "recommendations": ["建议1", "建议2"]
}`,
        context: { query: request.query, citations: citationsInfo, focusMode: request.focusMode },
      });

      const parsed = JSON.parse(result.result.text);
      return {
        evidenceQuality: (parsed.evidenceQuality as "sufficient" | "partial" | "insufficient") || "partial",
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String) : [],
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.map(String) : [],
      };
    } catch {
      return {
        evidenceQuality: "partial",
        gaps: ["证据评估服务暂时不可用"],
        recommendations: ["请结合其他信息源进行判断"],
      };
    }
  }
}

import { ServerEnv } from "../../shared/config.js";
import { createLogger } from "../logger.js";
import { type Logger } from "pino";

type SupportedExchange = "SSE" | "SZSE" | "BSE";

type SecurityProfile = {
  input: string;
  securityCode: string;
  displayName: string;
  exchange: SupportedExchange;
};

type ParsedOfficialPageInput = {
  securityCode: string;
  exchange: SupportedExchange | null;
  sseRegularUrl?: string;
  bseAnnouncementUrl?: string;
  eastmoneyStockUrl?: string;
};

/**
 * 数据采集代理配置选项
 */
export interface DataGatheringAgentOptions {
  env: ServerEnv;
  logger?: Logger;
}

/**
 * 统一的数据采集代理（Agent），提供主工作流调用的接口
 * 负责从各大数据源（交易所、东方财富、国家统计局等）自动化检索和抓取数据
 */
export class DataGatheringAgent {
  private env: ServerEnv;
  private logger: Logger;
  private readonly requestHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
  };

  constructor(options: DataGatheringAgentOptions) {
    this.env = options.env;
    this.logger = options.logger || createLogger(options.env);
  }

  /**
   * 通用的带错误处理的请求方法
   */
  private async fetchWithRetry(url: string, options: RequestInit, retries = Math.min(this.env.EXTERNAL_FETCH_RETRY_COUNT + 1, 2)): Promise<Response> {
    for (let i = 0; i < retries; i++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(this.env.EXTERNAL_FETCH_TIMEOUT_MS, 3000));
      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status} for ${url}`);
        }
        return response;
      } catch (error) {
        if (error instanceof Error && error.message.includes("HTTP error!") && /status: [45]\d\d/.test(error.message) && !error.message.includes("status: 429") && !error.message.includes("status: 5")) {
          throw error;
        }
        this.logger.warn(`请求失败 (${url}), 第 ${i + 1} 次重试...`);
        if (i === retries - 1) {
          this.logger.error(error instanceof Error ? error : new Error(String(error)), `请求完全失败 (${url})`);
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error(`Unreachable`);
  }

  private parseJsonLikePayload<T>(raw: string): T {
    const text = raw.trim();
    if (!text) {
      return {} as T;
    }

    if (text.startsWith("{") || text.startsWith("[")) {
      return JSON.parse(text) as T;
    }

    const jsonpMatch = text.match(/^[^(]+\(([\s\S]+)\)\s*;?$/);
    const jsonpPayload = jsonpMatch?.[1];
    if (jsonpPayload) {
      return JSON.parse(jsonpPayload) as T;
    }

    throw new Error("无法解析外部接口返回内容。");
  }

  private normalizeUrl(url: string | undefined, baseUrl: string) {
    if (!url) {
      return "";
    }

    try {
      return new URL(url, baseUrl).toString();
    } catch {
      return url;
    }
  }

  private escapeRegex(text: string) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  private decodeHtmlEntities(text: string) {
    return text
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;/gi, "'");
  }

  private stripHtmlTags(text: string) {
    return this.decodeHtmlEntities(text)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private extractHtmlAttribute(tag: string, attribute: string) {
    const matched = tag.match(new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"));
    return matched?.[1]?.trim() ?? "";
  }

  private extractHtmlAnchors(html: string) {
    return [...html.matchAll(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi)]
      .map((match) => {
        const tag = match[0] ?? "";
        const href = this.extractHtmlAttribute(tag, "href");
        const title = this.extractHtmlAttribute(tag, "title");
        const dataTitle = this.extractHtmlAttribute(tag, "data-title");
        const text = this.stripHtmlTags(tag);
        return {
          href,
          title: title || dataTitle || text,
          text,
          tag,
        };
      })
      .filter((item) => item.href && item.title);
  }

  private extractSixDigitCodes(...values: Array<string | undefined>) {
    const codes: string[] = [];
    for (const value of values) {
      if (!value) {
        continue;
      }

      for (const match of value.matchAll(/(?:^|[^\d])(\d{6})(?!\d)/g)) {
        const code = match[1]?.trim();
        if (code && !codes.includes(code)) {
          codes.push(code);
        }
      }
    }

    return codes;
  }

  private extractYears(...values: Array<string | undefined>) {
    const years: string[] = [];
    for (const value of values) {
      if (!value) {
        continue;
      }

      for (const match of value.matchAll(/\b(20\d{2})\b/g)) {
        const year = match[1]?.trim();
        if (year && !years.includes(year)) {
          years.push(year);
        }
      }
    }

    return years;
  }

  private matchesRequestedSecurityCode(securityCode: string | undefined, ...values: Array<string | undefined>) {
    if (!securityCode) {
      return true;
    }

    const codes = this.extractSixDigitCodes(...values);
    return codes.length === 0 || codes.includes(securityCode);
  }

  private matchesRequestedYear(year: string | undefined, ...values: Array<string | undefined>) {
    if (!year) {
      return true;
    }

    const years = this.extractYears(...values);
    return years.length === 0 || years.includes(year);
  }

  private cleanInlineText(text: string) {
    return this.stripHtmlTags(text).replace(/\s+/g, " ").trim();
  }

  private extractHtmlBlocks(html: string) {
    const blocks = [...html.matchAll(/<(article|li|tr|section|div)\b[^>]*>[\s\S]*?<\/\1>/gi)]
      .map((match) => match[0] ?? "")
      .filter((block) => /<a\b/i.test(block));

    return blocks.length > 0 ? blocks : [html];
  }

  private extractNarrativeSummary(block: string, title: string) {
    const preferredSummary = [...block.matchAll(/<(p|div|span)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((match) => this.cleanInlineText(match[2] ?? ""))
      .find((item) =>
        item &&
        item !== title &&
        !/^PDF$/i.test(item) &&
        !/^\d+(?:[-/]\d+)*$/.test(item) &&
        /[\u4e00-\u9fffA-Za-z]/.test(item) &&
        item.length >= 6,
      );

    if (preferredSummary) {
      return preferredSummary;
    }

    const fallback = this.cleanInlineText(block)
      .replace(title, "")
      .replace(/\bPDF\b/gi, "")
      .trim();

    return fallback || "已抓取到外部研报，但未返回摘要字段。";
  }

  private parseHtmlReportAnchors(html: string, baseUrl: string, options: {
    year?: string;
    securityCode?: string;
    reportPattern: RegExp;
    limit?: number;
  }) {
    const reports = this.extractHtmlBlocks(html)
      .map((block) => {
        const anchors = this.extractHtmlAnchors(block);
        if (anchors.length === 0) {
          return null;
        }

        const titledAnchor = anchors.find((anchor) => options.reportPattern.test(anchor.title) || options.reportPattern.test(anchor.text));
        const pdfAnchor = anchors.find((anchor) => /\.pdf(?:$|[?#])/i.test(anchor.href));
        const reportAnchor = titledAnchor ?? pdfAnchor ?? anchors[0];
        const title = this.cleanInlineText(titledAnchor?.title || titledAnchor?.text || reportAnchor?.title || reportAnchor?.text || "");
        const blockText = this.cleanInlineText(block);
        const context = [title, blockText, ...anchors.flatMap((anchor) => [anchor.title, anchor.text, anchor.href])];

        if (!reportAnchor?.href) {
          return null;
        }
        if (!options.reportPattern.test(title) && !options.reportPattern.test(blockText)) {
          return null;
        }
        if (!this.matchesRequestedYear(options.year, ...context)) {
          return null;
        }
        if (!this.matchesRequestedSecurityCode(options.securityCode, ...context)) {
          return null;
        }

        return {
          title,
          url: this.normalizeUrl(reportAnchor.href, baseUrl),
        };
      })
      .filter((item): item is { title: string; url: string } => Boolean(item))
      .filter((item) => item.title && item.url)
      .filter((item, index, items) => items.findIndex((candidate) => candidate.url === item.url) === index);

    return reports.slice(0, options.limit ?? 5);
  }

  private parseEastmoneyHtmlReports(html: string, fallbackTitle: string, options?: { securityCode?: string; year?: string }) {
    const candidates = this.extractHtmlBlocks(html)
      .map((block) => {
        const anchors = this.extractHtmlAnchors(block);
        const reportAnchor = anchors.find((item) => /研报|报告|点评|覆盖|深度/i.test(item.title) || /report|yanbao|detail/i.test(item.href));
        const pdfAnchor = anchors.find((item) => /\.pdf(?:$|[?#])/i.test(item.href));
        const infoCode =
          block.match(/(?:infoCode|infocode|data-infocode)\s*[:=]\s*["']?([A-Z0-9]+)["']?/i)?.[1] ??
          this.extractHtmlAttribute(block, "data-infocode");
        const text = this.cleanInlineText(block);
        const title = this.cleanInlineText(reportAnchor?.title || reportAnchor?.text || fallbackTitle);
        const context = [title, text, infoCode, ...anchors.flatMap((item) => [item.title, item.text, item.href])];
        if (!reportAnchor && !pdfAnchor) {
          return null;
        }
        if (!/研报|报告|点评|覆盖|深度/i.test(title) && !/研报|报告|点评|覆盖|深度/i.test(text)) {
          return null;
        }
        if (!this.matchesRequestedSecurityCode(options?.securityCode, ...context)) {
          return null;
        }
        if (!this.matchesRequestedYear(options?.year, ...context)) {
          return null;
        }

        const summary = this.extractNarrativeSummary(block, title);
        const pdfUrl = pdfAnchor?.href
          ? this.normalizeUrl(pdfAnchor.href, "https://report.eastmoney.com/")
          : infoCode
            ? `https://pdf.dfcfw.com/pdf/H3_${infoCode}_1.pdf`
            : reportAnchor?.href && /report|pdf/i.test(reportAnchor.href)
              ? this.normalizeUrl(reportAnchor.href, "https://report.eastmoney.com/")
              : "";

        return {
          title,
          summary,
          pdfUrl,
        };
      })
      .filter((item): item is { title: string; summary: string; pdfUrl: string } => Boolean(item))
      .filter((item) => item.title && /研报|报告|点评|覆盖|深度/i.test(item.title))
      .filter((item, index, items) => items.findIndex((candidate) => candidate.title === item.title && candidate.pdfUrl === item.pdfUrl) === index);

    return candidates.slice(0, 5);
  }

  private extractSixDigitCode(...values: Array<string | undefined>) {
    for (const value of values) {
      if (!value) {
        continue;
      }

      const matched = value.match(/(^|[^\d])(\d{6})(?!\d)/);
      if (matched?.[2]) {
        return matched[2];
      }
    }

    return "";
  }

  private parseOfficialPageInput(input: string): ParsedOfficialPageInput | null {
    const trimmed = input.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      return null;
    }

    try {
      const url = new URL(trimmed);
      const hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
      const securityCode = this.extractSixDigitCode(
        url.searchParams.get("productId") ?? undefined,
        url.searchParams.get("companyCode") ?? undefined,
        url.searchParams.get("code") ?? undefined,
        url.searchParams.get("stockCode") ?? undefined,
        url.pathname,
        trimmed,
      );
      const exchange = securityCode ? this.inferExchangeFromCode(securityCode) : null;

      if (hostname.endsWith("sse.com.cn") && /announcement\/index\.shtml|listedinfo\/regular/i.test(url.pathname)) {
        return {
          securityCode,
          exchange: exchange === "SSE" ? exchange : null,
          sseRegularUrl: url.toString(),
        };
      }

      if (hostname.endsWith("bse.cn") && /disclosure\/announcement/i.test(url.pathname)) {
        return {
          securityCode,
          exchange: exchange === "BSE" ? exchange : null,
          bseAnnouncementUrl: url.toString(),
        };
      }

      if (
        ((hostname === "report.eastmoney.com" && /\/report\//i.test(url.pathname)) ||
          (hostname === "data.eastmoney.com" && /\/report\/stock\.jshtml/i.test(url.pathname)))
      ) {
        return {
          securityCode,
          exchange,
          eastmoneyStockUrl: url.toString(),
        };
      }
    } catch {
      return null;
    }

    return null;
  }

  private normalizeSecurityCode(input: string): { securityCode: string; exchange: SupportedExchange } | null {
    const trimmed = input.trim();
    const prefixed = trimmed.match(/^(sh|sz|bj)(\d{6})$/i);
    if (prefixed) {
      const [, marketPrefix = "", code = ""] = prefixed;
      const exchange = marketPrefix.toUpperCase() === "SH"
        ? "SSE"
        : marketPrefix.toUpperCase() === "SZ"
          ? "SZSE"
          : "BSE";
      return {
        securityCode: code,
        exchange,
      } as const;
    }

    const digits = trimmed.replace(/\D/g, "");
    if (digits.length !== 6) {
      return null;
    }

    const exchange = this.inferExchangeFromCode(digits);
    if (!exchange) {
      return null;
    }

    return {
      securityCode: digits,
      exchange,
    } as const;
  }

  private inferExchangeFromCode(code: string): SupportedExchange | null {
    if (/^(600|601|603|605|688|689|900)/.test(code)) {
      return "SSE";
    }

    if (/^(000|001|002|003|200|300|301)/.test(code)) {
      return "SZSE";
    }

    if (/^(430|431|832|833|834|835|836|837|838|839|870|871|872|873|874|875|876|877|878|879|920)/.test(code)) {
      return "BSE";
    }

    return null;
  }

  private extractSearchCandidates(payload: unknown) {
    const candidateGroups = [
      (payload as { QuotationCodeTable?: { Data?: Array<Record<string, unknown>> } }).QuotationCodeTable?.Data,
      (payload as { data?: Array<Record<string, unknown>> }).data,
      (payload as { Data?: Array<Record<string, unknown>> }).Data,
      (payload as { result?: Array<Record<string, unknown>> }).result,
    ];

    return candidateGroups.find((items) => Array.isArray(items)) ?? [];
  }

  private getCandidateField(candidate: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = candidate[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return "";
  }

  private buildDegradedReports(label: string, year: string) {
    return {
      success: true,
      degraded: true,
      reports: [{ title: `${year}年${label}`, url: "", note: "外部连接失败，已返回降级结果" }],
    };
  }

  private buildDegradedResearch(title: string, summary: string) {
    return {
      success: true,
      degraded: true,
      data: [{ title, summary, pdfUrl: "" }],
    };
  }

  private parseEastmoneyResponse(payload: unknown, fallbackTitle: string, options?: { securityCode?: string; year?: string }) {
    const records =
      (payload as {
        data?: Array<{
          title?: string;
          reportTitle?: string;
          summary?: string;
          digest?: string;
          pdfUrl?: string;
          infoCode?: string;
          code?: string;
          stockCode?: string;
          secCode?: string;
          publishDate?: string;
          pubDate?: string;
          date?: string;
        }>;
        result?: {
          data?: Array<{
            title?: string;
            reportTitle?: string;
            summary?: string;
            digest?: string;
            pdfUrl?: string;
            infoCode?: string;
            code?: string;
            stockCode?: string;
            secCode?: string;
            publishDate?: string;
            pubDate?: string;
            date?: string;
          }>;
        };
      })
        ?.data ?? [];
    const fallbackRecords =
      (payload as {
        result?: {
          data?: Array<{
            title?: string;
            reportTitle?: string;
            summary?: string;
            digest?: string;
            pdfUrl?: string;
            infoCode?: string;
            code?: string;
            stockCode?: string;
            secCode?: string;
            publishDate?: string;
            pubDate?: string;
            date?: string;
          }>;
        };
      }).result?.data ?? [];
    const resolvedRecords = records.length > 0 ? records : fallbackRecords;
    const items = resolvedRecords
      .map((item) => {
        const title = item.title ?? item.reportTitle ?? fallbackTitle;
        const summary = item.summary ?? item.digest ?? "已抓取到外部研报，但未返回摘要字段。";
        const pdfUrl = item.pdfUrl
          ? this.normalizeUrl(item.pdfUrl, "https://report.eastmoney.com/")
          : item.infoCode
            ? `https://pdf.dfcfw.com/pdf/H3_${item.infoCode}_1.pdf`
            : "";
        const context = [title, summary, pdfUrl, item.infoCode, item.code, item.stockCode, item.secCode, item.publishDate, item.pubDate, item.date];
        if (!this.matchesRequestedSecurityCode(options?.securityCode, ...context)) {
          return null;
        }
        if (!this.matchesRequestedYear(options?.year, ...context)) {
          return null;
        }

        return {
          title,
          summary,
          pdfUrl,
        };
      })
      .filter((item): item is { title: string; summary: string; pdfUrl: string } => Boolean(item))
      .filter((item) => item.title);

    return items.slice(0, 5);
  }

  private async fetchSSEReportsFromHtml(source: string, year: string) {
    const officialInput = this.parseOfficialPageInput(source);
    const companyCode = officialInput?.securityCode || this.extractSixDigitCode(source);
    const url =
      officialInput?.sseRegularUrl ??
      `https://www.sse.com.cn/assortment/stock/list/info/announcement/index.shtml?productId=${encodeURIComponent(companyCode)}`;
    const response = await this.fetchWithRetry(url, {
      headers: {
        ...this.requestHeaders,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: "https://www.sse.com.cn/",
      },
    });
    const html = await response.text();
    return this.parseHtmlReportAnchors(html, "https://www.sse.com.cn", {
      year,
      securityCode: companyCode,
      reportPattern: /年度报告|半年报告|季度报告|定期报告|年报|半年报|季报/i,
    });
  }

  private async fetchBSEReportsFromHtml(source: string, year: string) {
    const officialInput = this.parseOfficialPageInput(source);
    const companyCode = officialInput?.securityCode || this.extractSixDigitCode(source);
    const url =
      officialInput?.bseAnnouncementUrl ??
      `https://www.bse.cn/disclosure/announcement.html?companyCode=${encodeURIComponent(companyCode)}`;
    const response = await this.fetchWithRetry(url, {
      headers: {
        ...this.requestHeaders,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: "https://www.bse.cn/",
      },
    });
    const html = await response.text();
    return this.parseHtmlReportAnchors(html, "https://www.bse.cn", {
      year,
      securityCode: companyCode,
      reportPattern: /年度报告|半年报告|季度报告|定期报告|年报|半年报|季报/i,
    });
  }

  private async fetchEastmoneyReportsFromHtml(
    identifier: string,
    fallbackTitle: string,
    type: "stock" | "industry",
    options?: { securityCode?: string; year?: string },
  ) {
    const officialInput = type === "stock" ? this.parseOfficialPageInput(identifier) : null;
    const url =
      type === "stock"
        ? officialInput?.eastmoneyStockUrl ?? "https://data.eastmoney.com/report/stock.jshtml"
        : "https://data.eastmoney.com/report/industry.jshtml";
    const response = await this.fetchWithRetry(url, {
      headers: {
        ...this.requestHeaders,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Referer: "https://report.eastmoney.com/",
      },
    });
    const html = await response.text();
    return this.parseEastmoneyHtmlReports(html, fallbackTitle, options);
  }

  private shouldUseLiveNetwork() {
    return this.env.NODE_ENV !== "test";
  }

  async resolveSecurityProfile(identifier: string): Promise<SecurityProfile | null> {
    const officialInput = this.parseOfficialPageInput(identifier);
    if (officialInput) {
      if (officialInput.securityCode && officialInput.exchange) {
        return {
          input: identifier,
          securityCode: officialInput.securityCode,
          displayName: officialInput.securityCode,
          exchange: officialInput.exchange,
        };
      }

      return null;
    }

    const normalized = this.normalizeSecurityCode(identifier);
    if (normalized) {
      return {
        input: identifier,
        securityCode: normalized.securityCode,
        displayName: identifier,
        exchange: normalized.exchange,
      };
    }

    if (!this.shouldUseLiveNetwork()) {
      return null;
    }

    const url = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(identifier)}&type=14&count=10`;
    try {
      const response = await this.fetchWithRetry(url, {
        headers: {
          ...this.requestHeaders,
          Referer: "https://www.eastmoney.com/",
        },
      });
      const payload = this.parseJsonLikePayload<unknown>(await response.text());
      const candidates = this.extractSearchCandidates(payload);
      const matched = candidates
        .map((candidate) => {
          const securityCode = this.getCandidateField(candidate, ["Code", "code", "SecurityCode", "securityCode"]);
          const displayName = this.getCandidateField(candidate, ["Name", "name", "ShortName", "shortName"]);
          const exchange = this.inferExchangeFromCode(securityCode);
          return securityCode && exchange
            ? {
                input: identifier,
                securityCode,
                displayName: displayName || identifier,
                exchange,
              }
            : null;
        })
        .find((item): item is SecurityProfile => Boolean(item));

      return matched ?? null;
    } catch (error) {
      this.logger.warn(
        error instanceof Error ? error : new Error(String(error)),
        `证券代码解析失败 [${identifier}]，将走降级链路`,
      );
      return null;
    }
  }

  async collectEnterpriseFinancialData(identifier: string, year: string) {
    const officialInput = this.parseOfficialPageInput(identifier);
    const securityProfile = await this.resolveSecurityProfile(identifier);
    if (!securityProfile) {
      return {
        success: true,
        degraded: true,
        securityProfile: {
          input: identifier,
          securityCode: "",
          displayName: identifier,
          exchange: "SZSE" as SupportedExchange,
        },
        exchangeReports: this.buildDegradedReports("交易所定期报告", year).reports,
        eastmoneyReports: this.buildDegradedResearch(
          `${identifier} 外部研报`,
          "未能解析证券代码，已返回降级摘要。",
        ).data,
      };
    }

    const exchangePromise =
      securityProfile.exchange === "SSE"
        ? this.fetchSSEReports(officialInput?.sseRegularUrl ? identifier : securityProfile.securityCode, year)
        : securityProfile.exchange === "SZSE"
          ? this.fetchSZSEReports(securityProfile.securityCode, year)
          : this.fetchBSEReports(officialInput?.bseAnnouncementUrl ? identifier : securityProfile.securityCode, year);
    const [exchangeReports, eastmoneyReports] = await Promise.all([
      exchangePromise,
      this.fetchEastmoneyStockReports(officialInput?.eastmoneyStockUrl ? identifier : securityProfile.securityCode, year),
    ]);

    return {
      success: true,
      degraded: exchangeReports.degraded || eastmoneyReports.degraded,
      securityProfile,
      exchangeReports: exchangeReports.reports,
      eastmoneyReports: eastmoneyReports.data,
    };
  }

  // ==========================================
  // 1. 交易所定期财报数据抓取 (SSE, SZSE, BSE)
  // ==========================================

  /**
   * 获取上交所 (SSE) 定期财报数据
   * @param companyCode 公司代码 (如 600000)
   * @param year 年份 (如 2023)
   */
  async fetchSSEReports(companyCode: string, year: string) {
    this.logger.info(`开始获取上交所财报数据: 公司 ${companyCode}, 年份 ${year}`);
    if (!this.shouldUseLiveNetwork()) {
      return this.buildDegradedReports("定期报告", year);
    }
    const officialInput = this.parseOfficialPageInput(companyCode);
    const resolvedCompanyCode = officialInput?.securityCode ?? companyCode;
    const degradedReports = this.buildDegradedReports("定期报告", year).reports;
    if (officialInput?.sseRegularUrl) {
      const htmlReports = await this.fetchSSEReportsFromHtml(officialInput.sseRegularUrl, year).catch((error) => {
        this.logger.warn(error instanceof Error ? error : new Error(String(error)), `上交所用户提供页面解析失败 [${companyCode}]`);
        return [];
      });
      if (htmlReports.length > 0) {
        return {
          success: true,
          degraded: false,
          reports: htmlReports,
        };
      }
    }

    if (!/^\d{6}$/.test(resolvedCompanyCode)) {
      return {
        success: true,
        degraded: true,
        reports: degradedReports,
      };
    }

    const url = `https://query.sse.com.cn/security/stock/queryCompanyBulletin.do?productId=${encodeURIComponent(resolvedCompanyCode)}&reportType=ALL&beginDate=${year}-01-01&endDate=${year}-12-31&pageHelp.pageSize=20`;
    try {
      const headers = {
        ...this.requestHeaders,
        Referer: "https://www.sse.com.cn/",
      };
      const response = await this.fetchWithRetry(url, { headers });
      const data = (await response.json()) as {
        result?: Array<{ BULLETIN_TYPE?: string; TITLE?: string; URL?: string }>;
      };
      const reports =
        data.result?.slice(0, 5).map((item) => ({
          title: item.TITLE ?? `${year}年年度报告`,
          url: this.normalizeUrl(item.URL, "https://www.sse.com.cn"),
          bulletinType: item.BULLETIN_TYPE ?? "unknown",
        })) ?? [];

      if (reports.length === 0) {
        const htmlReports = await this.fetchSSEReportsFromHtml(officialInput?.sseRegularUrl ?? resolvedCompanyCode, year).catch((error) => {
          this.logger.warn(error instanceof Error ? error : new Error(String(error)), `上交所 HTML 兜底解析失败 [${companyCode}]`);
          return [];
        });
        return {
          success: true,
          degraded: htmlReports.length === 0,
          reports: htmlReports.length > 0 ? htmlReports : degradedReports,
        };
      }

      return {
        success: true,
        degraded: false,
        reports,
      };
    } catch (error) {
      this.logger.error(error instanceof Error ? error : new Error(String(error)), `获取上交所财报数据异常 [${companyCode}]`);
      const htmlReports = await this.fetchSSEReportsFromHtml(officialInput?.sseRegularUrl ?? resolvedCompanyCode, year).catch((htmlError) => {
        this.logger.warn(htmlError instanceof Error ? htmlError : new Error(String(htmlError)), `上交所 HTML 兜底解析失败 [${companyCode}]`);
        return [];
      });
      return {
        success: true,
        degraded: htmlReports.length === 0,
        reports: htmlReports.length > 0 ? htmlReports : degradedReports,
      };
    }
  }

  /**
   * 获取深交所 (SZSE) 定期财报数据
   * @param companyCode 公司代码 (如 000001)
   * @param year 年份 (如 2023)
   */
  async fetchSZSEReports(companyCode: string, year: string) {
    this.logger.info(`开始获取深交所财报数据: 公司 ${companyCode}, 年份 ${year}`);
    if (!this.shouldUseLiveNetwork()) {
      return this.buildDegradedReports("深交所定期报告", year);
    }
    const url = `https://www.szse.cn/api/disc/announcement/annList?random=${Math.random()}`;
    try {
      const payload = {
        seDate: [`${year}-01-01`, `${year}-12-31`],
        stock: [companyCode],
        channelCode: ["fixed_disc"],
      };
      const headers = {
        ...this.requestHeaders,
        "Content-Type": "application/json",
      };
      const response = await this.fetchWithRetry(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const data = (await response.json()) as {
        data?: Array<{ title?: string; attachPath?: string; secName?: string }>;
      };
      const reports =
        data.data?.slice(0, 5).map((item) => ({
          title: item.title ?? `${item.secName ?? companyCode}${year}年年度报告`,
          url: this.normalizeUrl(item.attachPath, "https://disc.static.szse.cn/download"),
        })) ?? [];

      return {
        success: true,
        degraded: reports.length === 0,
        reports: reports.length > 0 ? reports : this.buildDegradedReports("深交所定期报告", year).reports,
      };
    } catch (error) {
      this.logger.error(error instanceof Error ? error : new Error(String(error)), `获取深交所财报数据异常 [${companyCode}]`);
      return this.buildDegradedReports("深交所定期报告", year);
    }
  }

  /**
   * 获取北交所 (BSE) 定期财报数据
   * @param companyCode 公司代码 (如 830000)
   * @param year 年份
   */
  async fetchBSEReports(companyCode: string, year: string) {
    this.logger.info(`开始获取北交所财报数据: 公司 ${companyCode}, 年份 ${year}`);
    if (!this.shouldUseLiveNetwork()) {
      return this.buildDegradedReports("北交所定期报告", year);
    }
    const officialInput = this.parseOfficialPageInput(companyCode);
    const resolvedCompanyCode = officialInput?.securityCode ?? companyCode;
    const url = `https://www.bse.cn/disclosureInfoController/infoResult.do`;
    const degradedReports = this.buildDegradedReports("北交所定期报告", year).reports;
    if (officialInput?.bseAnnouncementUrl) {
      const htmlReports = await this.fetchBSEReportsFromHtml(officialInput.bseAnnouncementUrl, year).catch((error) => {
        this.logger.warn(error instanceof Error ? error : new Error(String(error)), `北交所用户提供页面解析失败 [${companyCode}]`);
        return [];
      });
      if (htmlReports.length > 0) {
        return {
          success: true,
          degraded: false,
          reports: htmlReports,
        };
      }
    }

    if (!/^\d{6}$/.test(resolvedCompanyCode)) {
      return {
        success: true,
        degraded: true,
        reports: degradedReports,
      };
    }

    try {
      const formData = new URLSearchParams();
      formData.append("companyCd", resolvedCompanyCode);
      formData.append("isNewThree", "1");
      formData.append("startTime", `${year}-01-01`);
      formData.append("endTime", `${year}-12-31`);
      const response = await this.fetchWithRetry(url, {
        method: "POST",
        body: formData,
        headers: {
          ...this.requestHeaders,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
      const html = await response.text();
      const matches = [...html.matchAll(/<a[^>]+href="([^"]+)"[^>]*title="([^"]+报告[^"]*)"/g)];
      if (matches.length === 0) {
        const htmlReports = await this.fetchBSEReportsFromHtml(officialInput?.bseAnnouncementUrl ?? resolvedCompanyCode, year).catch((error) => {
          this.logger.warn(error instanceof Error ? error : new Error(String(error)), `北交所 HTML 兜底解析失败 [${companyCode}]`);
          return [];
        });
        return {
          success: true,
          degraded: htmlReports.length === 0,
          reports: htmlReports.length > 0 ? htmlReports : degradedReports,
        };
      }

      return {
        success: true,
        degraded: false,
        reports: matches.slice(0, 5).map((item) => ({
          title: item[2],
          url: this.normalizeUrl(item[1], "https://www.bse.cn"),
        })),
      };
    } catch (error) {
      this.logger.error(error instanceof Error ? error : new Error(String(error)), `获取北交所财报数据异常 [${companyCode}]`);
      const htmlReports = await this.fetchBSEReportsFromHtml(officialInput?.bseAnnouncementUrl ?? resolvedCompanyCode, year).catch((htmlError) => {
        this.logger.warn(htmlError instanceof Error ? htmlError : new Error(String(htmlError)), `北交所 HTML 兜底解析失败 [${companyCode}]`);
        return [];
      });
      return {
        success: true,
        degraded: htmlReports.length === 0,
        reports: htmlReports.length > 0 ? htmlReports : degradedReports,
      };
    }
  }

  // ==========================================
  // 2. 东方财富网研报数据抓取与解析
  // ==========================================

  /**
   * 抓取行业研报 (东方财富)
   * @param industryCode 行业代码/名称
   */
  async fetchEastmoneyIndustryReports(industryCode: string) {
    this.logger.info(`开始抓取东方财富行业研报: 行业 ${industryCode}`);
    if (!this.shouldUseLiveNetwork()) {
      return this.buildDegradedResearch(
        `[${industryCode}] 行业深度报告`,
        "测试环境禁用外部网络，已返回降级摘要。",
      );
    }
    const url = `https://reportapi.eastmoney.com/report/list?industryCode=${industryCode}&pageSize=50&pageNo=1`;
    const degradedResearch = [
      { title: `[${industryCode}] 行业深度报告`, summary: "外部研报服务暂不可用，已返回降级摘要。", pdfUrl: "" },
    ];
    try {
      const response = await this.fetchWithRetry(url, {
        method: "GET",
        headers: {
          ...this.requestHeaders,
          Referer: "https://report.eastmoney.com/",
        },
      });
      const data = this.parseJsonLikePayload<unknown>(await response.text());
      const reports = this.parseEastmoneyResponse(data, `[${industryCode}] 行业深度报告`);

      if (reports.length === 0) {
        const htmlReports = await this.fetchEastmoneyReportsFromHtml(
          industryCode,
          `[${industryCode}] 行业深度报告`,
          "industry",
        ).catch((error) => {
          this.logger.warn(error instanceof Error ? error : new Error(String(error)), `东方财富行业研报 HTML 兜底解析失败 [${industryCode}]`);
          return [];
        });
        return {
          success: true,
          degraded: htmlReports.length === 0,
          data: htmlReports.length > 0 ? htmlReports : degradedResearch,
        };
      }

      return {
        success: true,
        degraded: false,
        data: reports,
      };
    } catch (error) {
      this.logger.error(error instanceof Error ? error : new Error(String(error)), `抓取东方财富行业研报异常`);
      const htmlReports = await this.fetchEastmoneyReportsFromHtml(
        industryCode,
        `[${industryCode}] 行业深度报告`,
        "industry",
      ).catch((htmlError) => {
        this.logger.warn(htmlError instanceof Error ? htmlError : new Error(String(htmlError)), `东方财富行业研报 HTML 兜底解析失败 [${industryCode}]`);
        return [];
      });
      return {
        success: true,
        degraded: htmlReports.length === 0,
        data: htmlReports.length > 0 ? htmlReports : degradedResearch,
      };
    }
  }

  /**
   * 抓取个股研报 (东方财富)
   * @param companyCode 个股代码
   */
  async fetchEastmoneyStockReports(companyCode: string, year?: string) {
    this.logger.info(`开始抓取东方财富个股研报: 公司 ${companyCode}`);
    if (!this.shouldUseLiveNetwork()) {
      return this.buildDegradedResearch(
        `${companyCode} 首次覆盖报告`,
        "测试环境禁用外部网络，已返回降级摘要。",
      );
    }
    const officialInput = this.parseOfficialPageInput(companyCode);
    const resolvedCompanyCode = officialInput?.securityCode ?? companyCode;
    const degradedResearch = [
      { title: `${resolvedCompanyCode || companyCode} 首次覆盖报告`, summary: "外部研报服务暂不可用，已返回降级摘要。", pdfUrl: "" },
    ];
    if (officialInput?.eastmoneyStockUrl) {
      const htmlReports = await this.fetchEastmoneyReportsFromHtml(
        officialInput.eastmoneyStockUrl,
        `${resolvedCompanyCode || companyCode} 研究报告`,
        "stock",
        { securityCode: resolvedCompanyCode, year },
      ).catch((error) => {
        this.logger.warn(error instanceof Error ? error : new Error(String(error)), `东方财富个股研报用户提供页面解析失败 [${companyCode}]`);
        return [];
      });
      if (htmlReports.length > 0) {
        return {
          success: true,
          degraded: false,
          data: htmlReports,
        };
      }
    }

    if (!/^\d{6}$/.test(resolvedCompanyCode)) {
      return {
        success: true,
        degraded: true,
        data: degradedResearch,
      };
    }

    const url = `https://reportapi.eastmoney.com/report/list?code=${resolvedCompanyCode}&pageSize=50&pageNo=1`;
    try {
      const response = await this.fetchWithRetry(url, {
        method: "GET",
        headers: {
          ...this.requestHeaders,
          Referer: "https://report.eastmoney.com/",
        },
      });
      const data = this.parseJsonLikePayload<unknown>(await response.text());
      const reports = this.parseEastmoneyResponse(data, `${resolvedCompanyCode} 研究报告`, {
        securityCode: resolvedCompanyCode,
        year,
      });

      if (reports.length === 0) {
        const htmlReports = await this.fetchEastmoneyReportsFromHtml(
          officialInput?.eastmoneyStockUrl ?? resolvedCompanyCode,
          `${resolvedCompanyCode} 研究报告`,
          "stock",
          { securityCode: resolvedCompanyCode, year },
        ).catch((error) => {
          this.logger.warn(error instanceof Error ? error : new Error(String(error)), `东方财富个股研报 HTML 兜底解析失败 [${companyCode}]`);
          return [];
        });
        return {
          success: true,
          degraded: htmlReports.length === 0,
          data: htmlReports.length > 0 ? htmlReports : degradedResearch,
        };
      }

      return {
        success: true,
        degraded: false,
        data: reports,
      };
    } catch (error) {
      this.logger.error(error instanceof Error ? error : new Error(String(error)), `抓取东方财富个股研报异常`);
      const htmlReports = await this.fetchEastmoneyReportsFromHtml(
        officialInput?.eastmoneyStockUrl ?? resolvedCompanyCode,
        `${resolvedCompanyCode} 研究报告`,
        "stock",
        { securityCode: resolvedCompanyCode, year },
      ).catch((htmlError) => {
        this.logger.warn(htmlError instanceof Error ? htmlError : new Error(String(htmlError)), `东方财富个股研报 HTML 兜底解析失败 [${companyCode}]`);
        return [];
      });
      return {
        success: true,
        degraded: htmlReports.length === 0,
        data: htmlReports.length > 0 ? htmlReports : degradedResearch,
      };
    }
  }

  // ==========================================
  // 3. 国家统计局宏观经济数据获取模块
  // ==========================================

  private async buildNbsAuthHeaders() {
    const account = this.env.NBS_ACCOUNT;
    const password = this.env.NBS_PASSWORD;
    const cookie = this.env.NBS_COOKIE;
    const token = this.env.NBS_TOKEN;

    if (cookie) {
      return {
        Cookie: cookie,
      } satisfies Record<string, string>;
    }

    if (token) {
      return {
        Authorization: `Bearer ${token}`,
        Cookie: `nbs_token=${token}; stats_token=${token}`,
      } satisfies Record<string, string>;
    }

    if (!account || !password) {
      return null;
    }

    const attempts = [
      {
        url: "https://data.stats.gov.cn/auth/login",
        headers: {
          ...this.requestHeaders,
          "Content-Type": "application/json",
          Referer: "https://data.stats.gov.cn/",
        },
        body: JSON.stringify({
          username: account,
          password,
        }),
      },
      {
        url: "https://data.stats.gov.cn/user/login",
        headers: {
          ...this.requestHeaders,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: "https://data.stats.gov.cn/",
        },
        body: new URLSearchParams({
          username: account,
          password,
        }).toString(),
      },
      {
        url: "https://data.stats.gov.cn/easyquery.htm",
        headers: {
          ...this.requestHeaders,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Referer: "https://data.stats.gov.cn/",
        },
        body: new URLSearchParams({
          m: "login",
          username: account,
          password,
        }).toString(),
      },
    ];

    for (const attempt of attempts) {
      try {
        const response = await this.fetchWithRetry(attempt.url, {
          method: "POST",
          headers: attempt.headers,
          body: attempt.body,
        });
        const rawText = await response.text();
        const payload = rawText ? this.parseJsonLikePayload<Record<string, unknown>>(rawText) : {};
        const loginToken =
          typeof payload.token === "string"
            ? payload.token
            : typeof payload.accessToken === "string"
              ? payload.accessToken
              : undefined;
        const setCookie = response.headers.get("set-cookie");
        const cookie =
          setCookie
            ?.split(",")
            .map((item) => item.split(";")[0]?.trim() ?? "")
            .filter((item) => item.length > 0)
            .join("; ") ?? "";

        if (loginToken || cookie) {
          return {
            ...(loginToken ? { Authorization: `Bearer ${loginToken}` } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
          } satisfies Record<string, string>;
        }
      } catch (error) {
        this.logger.debug(
          error instanceof Error ? error : new Error(String(error)),
          `国家统计局登录候选接口失败 [${attempt.url}]`,
        );
      }
    }

    throw new Error("国家统计局凭证登录失败，未获取到可用令牌或 Cookie。");
  }

  private isPeriodMatched(recordTime: string, period: string) {
    if (!recordTime) {
      return false;
    }

    const normalizedTime = recordTime.replace(/\D/g, "");
    const normalizedPeriod = period.replace(/\D/g, "");
    if (period.includes("-")) {
      const [startRaw = "", endRaw = ""] = period.split("-", 2);
      if (!startRaw || !endRaw) {
        return normalizedTime.startsWith(normalizedPeriod);
      }
      const start = startRaw.replace(/\D/g, "");
      const end = endRaw.replace(/\D/g, "");
      return normalizedTime >= start && normalizedTime <= end;
    }

    return normalizedTime.startsWith(normalizedPeriod);
  }

  /**
   * 获取国家统计局宏观经济数据
   * 支持配置账号模拟登录或凭证认证
   * @param indicatorCode 指标代码
   * @param period 时间段 (如 202301-202312)
   */
  async fetchNBSMacroData(indicatorCode: string, period: string) {
    this.logger.info(`开始获取国家统计局宏观数据: 指标 ${indicatorCode}, 时间 ${period}`);
    if (!this.shouldUseLiveNetwork()) {
      return {
        success: true,
        indicator: indicatorCode,
        period,
        records: [{ time: period, value: null, note: "测试环境禁用外部网络，已返回降级数据", isPlaceholder: true }],
        degraded: true,
      };
    }

    const authHeaders = await this.buildNbsAuthHeaders().catch((error) => {
      this.logger.warn(error instanceof Error ? error : new Error(String(error)), "国家统计局认证失败");
      return null;
    });

    if (!authHeaders) {
      this.logger.warn(
        `国家统计局数据获取警告: 未配置可用凭证 (NBS_COOKIE / NBS_TOKEN / NBS_ACCOUNT + NBS_PASSWORD)，降级使用公开宏观数据`,
      );
      return {
        success: true,
        indicator: indicatorCode,
        period: period,
        records: [
          { time: period, value: null, note: "公开降级数据", isPlaceholder: true }
        ],
        degraded: true,
      };
    }

    const url = `https://data.stats.gov.cn/easyquery.htm?m=QueryData&dbcode=hgyd&rowcode=zb&colcode=sj&wds=[]&dfwds=${encodeURIComponent(
      JSON.stringify([
        { wdcode: "zb", valuecode: indicatorCode },
      ]),
    )}`;
    try {
      const response = await this.fetchWithRetry(url, {
        headers: {
          ...this.requestHeaders,
          ...authHeaders,
          Referer: "https://data.stats.gov.cn/",
          Origin: "https://data.stats.gov.cn",
          "X-Requested-With": "XMLHttpRequest",
          "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        },
        method: "GET",
      });
      const data = this.parseJsonLikePayload<{
        returndata?: {
          datanodes?: Array<{
            data?: { strdata?: string };
            wds?: Array<{ wdcode?: string; valuecode?: string }>;
          }>;
        };
      }>(await response.text());
      const records =
        data.returndata?.datanodes
          ?.map((item) => ({
            time:
              item.wds?.find((dimension) => dimension.wdcode === "sj")?.valuecode ??
              item.wds?.at(-1)?.valuecode ??
              period,
            value: item.data?.strdata ?? "",
          }))
          .filter((item) => item.value && this.isPeriodMatched(item.time, period))
          .slice(0, 12) ?? [];

      return {
        success: true,
        indicator: indicatorCode,
        period: period,
        records: records.length > 0 ? records : [{ time: period, value: null, note: "外部接口空结果，已返回降级数据", isPlaceholder: true }],
        degraded: records.length === 0,
      };
    } catch (error) {
      this.logger.error(error instanceof Error ? error : new Error(String(error)), `获取国家统计局宏观数据异常`);
      return {
        success: true,
        indicator: indicatorCode,
        period: period,
        records: [{ time: period, value: null, note: "外部接口失败，已返回降级数据", isPlaceholder: true }],
        degraded: true,
      };
    }
  }
}

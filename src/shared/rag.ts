import { z } from "zod";

import {
  diagnosticRoleSchema,
  focusModeSchema,
  type IndustryCitation,
  type RagDocumentType,
} from "./agents.js";

export const realtimeRagRequestSchema = z.object({
  role: diagnosticRoleSchema.default("enterprise"),
  enterpriseName: z.string().min(1).optional(),
  query: z.string().min(1),
  focusMode: focusModeSchema.default("industryStatus"),
  limit: z.coerce.number().int().min(1).max(5).default(3),
  userInterests: z.array(z.string()).optional(),
  attentionTags: z.array(z.string()).optional(),
});

export type RealtimeRagRequest = z.output<typeof realtimeRagRequestSchema>;

export type RealtimeRagIndexStats = {
  searchHits: number;
  fetchedPages: number;
  chunkCount: number;
  rankedChunks: number;
  searchProvider: string;
  fallbackUsed: boolean;
  cacheHit?: boolean;
  filteredSources?: number;
  staleFiltered?: number;
  conflictWarnings?: string[];
  traceableCitations?: number;
  traceableDocuments?: number;
  documentTypes?: RagDocumentType[];
};

export type RealtimeRagResponse = {
  role: z.infer<typeof diagnosticRoleSchema>;
  focusMode: z.infer<typeof focusModeSchema>;
  query: string;
  retrievalSummary: string;
  referenceAbstract: string;
  citations: IndustryCitation[];
  indexStats: RealtimeRagIndexStats;
};

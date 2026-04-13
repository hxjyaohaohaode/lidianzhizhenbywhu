import { randomUUID } from "node:crypto";

import type { FocusMode, DiagnosticRole, MemoryEntry } from "../shared/agents.js";
import {
  memoryPreviewLimit,
  sessionSummaryLimit,
  type SessionContext,
  type SessionEvent,
} from "../shared/business.js";
import type { PlatformStore } from "./platform-store.js";

type SessionSnapshotState = Omit<SessionContext, "memoryPreview"> & {
  metadata: {
    enterpriseCollection?: Record<string, unknown>;
    investorProfile?: Record<string, unknown>;
    lastWorkflowId?: string;
    attachments?: SessionContext["attachments"];
    latestTimeline?: SessionContext["latestTimeline"];
    latestDebate?: SessionContext["latestDebate"];
    latestEvidenceSummary?: SessionContext["latestEvidenceSummary"];
    latestProfileUpdate?: SessionContext["latestProfileUpdate"];
    pendingClarificationQuestions?: SessionContext["pendingClarificationQuestions"];
  };
};

type UpsertSessionInput = {
  sessionId?: string;
  userId: string;
  role: DiagnosticRole;
  activeMode: FocusMode;
  enterpriseName?: string;
  summary: string;
  investedEnterprises?: string[];
  investorProfileSummary?: string;
  lastQuery?: string;
  recentEvent?: SessionEvent;
  metadata?: SessionSnapshotState["metadata"];
};

function mergeEvents(current: SessionEvent[], recentEvent?: SessionEvent) {
  return recentEvent ? [recentEvent, ...current].slice(0, sessionSummaryLimit) : current;
}

export class InMemorySessionStore {
  private readonly sessions = new Map<string, SessionSnapshotState>();

  constructor(private readonly platformStore?: PlatformStore) {}

  get(sessionId: string) {
    return this.platformStore
      ? this.platformStore.getSession<SessionSnapshotState>(sessionId)
      : this.sessions.get(sessionId);
  }

  require(sessionId: string) {
    const snapshot = this.get(sessionId);

    if (!snapshot) {
      throw new Error("session not found");
    }

    return snapshot;
  }

  async upsert(input: UpsertSessionInput) {
    const sessionId = input.sessionId ?? randomUUID();
    const current = this.get(sessionId);
    const next: SessionSnapshotState = {
      sessionId,
      userId: input.userId,
      role: input.role,
      activeMode: input.activeMode,
      enterpriseName: input.enterpriseName ?? current?.enterpriseName,
      summary: input.summary,
      investedEnterprises: input.investedEnterprises ?? current?.investedEnterprises ?? [],
      investorProfileSummary: input.investorProfileSummary ?? current?.investorProfileSummary,
      lastQuery: input.lastQuery ?? current?.lastQuery,
      recentEvents: mergeEvents(current?.recentEvents ?? [], input.recentEvent),
      attachments: input.metadata?.attachments ?? current?.attachments ?? [],
      latestTimeline: input.metadata?.latestTimeline ?? current?.latestTimeline ?? [],
      latestDebate: input.metadata?.latestDebate ?? current?.latestDebate ?? [],
      latestEvidenceSummary: input.metadata?.latestEvidenceSummary ?? current?.latestEvidenceSummary ?? [],
      latestProfileUpdate: input.metadata?.latestProfileUpdate ?? current?.latestProfileUpdate,
      pendingClarificationQuestions:
        input.metadata?.pendingClarificationQuestions ?? current?.pendingClarificationQuestions ?? [],
      updatedAt: new Date().toISOString(),
      metadata: {
        enterpriseCollection:
          input.metadata?.enterpriseCollection ?? current?.metadata.enterpriseCollection,
        investorProfile: input.metadata?.investorProfile ?? current?.metadata.investorProfile,
        lastWorkflowId: input.metadata?.lastWorkflowId ?? current?.metadata.lastWorkflowId,
        attachments: input.metadata?.attachments ?? current?.metadata.attachments,
        latestTimeline: input.metadata?.latestTimeline ?? current?.metadata.latestTimeline,
        latestDebate: input.metadata?.latestDebate ?? current?.metadata.latestDebate,
        latestEvidenceSummary:
          input.metadata?.latestEvidenceSummary ?? current?.metadata.latestEvidenceSummary,
        latestProfileUpdate: input.metadata?.latestProfileUpdate ?? current?.metadata.latestProfileUpdate,
        pendingClarificationQuestions:
          input.metadata?.pendingClarificationQuestions ??
          current?.metadata.pendingClarificationQuestions,
      },
    };

    if (this.platformStore) {
      await this.platformStore.upsertSession(next);
    } else {
      this.sessions.set(sessionId, next);
    }

    return next;
  }

  toContext(snapshot: SessionSnapshotState, memoryPreview: MemoryEntry[]): SessionContext {
    return {
      sessionId: snapshot.sessionId,
      userId: snapshot.userId,
      role: snapshot.role,
      activeMode: snapshot.activeMode,
      enterpriseName: snapshot.enterpriseName,
      summary: snapshot.summary,
      investedEnterprises: snapshot.investedEnterprises,
      investorProfileSummary: snapshot.investorProfileSummary,
      lastQuery: snapshot.lastQuery,
      recentEvents: snapshot.recentEvents,
      memoryPreview: memoryPreview.slice(0, memoryPreviewLimit),
      attachments: snapshot.attachments,
      latestTimeline: snapshot.latestTimeline,
      latestDebate: snapshot.latestDebate,
      latestEvidenceSummary: snapshot.latestEvidenceSummary,
      latestProfileUpdate: snapshot.latestProfileUpdate,
      pendingClarificationQuestions: snapshot.pendingClarificationQuestions,
      updatedAt: snapshot.updatedAt,
    };
  }

  listByUser(userId: string, role?: DiagnosticRole) {
    const items = this.platformStore
      ? this.platformStore.listSessions<SessionSnapshotState>()
      : [...this.sessions.values()];

    return items
      .filter((item) => item.userId === userId && (!role || item.role === role))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async delete(sessionId: string) {
    const snapshot = this.get(sessionId);

    if (!snapshot) {
      return undefined;
    }

    if (this.platformStore) {
      await this.platformStore.deleteSessions([sessionId]);
    } else {
      this.sessions.delete(sessionId);
    }

    return snapshot;
  }

  async deleteMany(sessionIds: string[]) {
    const snapshots = sessionIds
      .map((sessionId) => this.get(sessionId))
      .filter((item): item is SessionSnapshotState => Boolean(item));

    if (this.platformStore) {
      await this.platformStore.deleteSessions(sessionIds);
    } else {
      sessionIds.forEach((sessionId) => {
        this.sessions.delete(sessionId);
      });
    }

    return snapshots;
  }
}

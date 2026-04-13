import { randomUUID } from "node:crypto";

import type { MemoryEntry } from "../shared/agents.js";
import type { PlatformStore } from "./platform-store.js";

type MemoryWriteInput = Omit<MemoryEntry, "id" | "createdAt"> &
  Partial<Pick<MemoryEntry, "id" | "createdAt">>;

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
    const entry: MemoryEntry = {
      id: input.id ?? randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
      userId: input.userId,
      summary: input.summary,
      tags: input.tags,
      details: input.details,
      role: input.role,
      conversationId: input.conversationId,
      source: input.source,
    };

    if (this.platformStore) {
      await this.platformStore.saveMemory(entry);
      return entry;
    }

    const nextEntries = [...(this.entries.get(entry.userId) ?? []), entry];
    this.entries.set(entry.userId, nextEntries);
    return entry;
  }

  append(input: MemoryWriteInput) {
    return this.write(input);
  }

  async update(userId: string, memoryId: string, input: Pick<MemoryEntry, "summary" | "details" | "tags">) {
    if (this.platformStore) {
      return await this.platformStore.updateMemory(userId, memoryId, (current) => ({
        ...current,
        summary: input.summary,
        details: input.details,
        tags: input.tags,
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
      tags: input.tags,
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

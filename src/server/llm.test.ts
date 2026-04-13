import { describe, expect, it } from "vitest";

import type { LlmExecutionRequest, LlmExecutionResponse, LlmProviderAdapter } from "./llm.js";
import { ModelExecutionError, ModelRouter } from "./llm.js";

function createAdapter(options: {
  provider: "deepseekReasoner" | "glm5" | "qwen35Plus";
  model: string;
  available: boolean;
  fail?: boolean;
}) {
  return {
    provider: options.provider,
    model: options.model,
    isAvailable() {
      return options.available;
    },
    async complete(request: LlmExecutionRequest): Promise<LlmExecutionResponse> {
      void request;
      if (options.fail) {
        throw new Error(`${options.provider} failed`);
      }

      return {
        provider: options.provider,
        model: options.model,
        text: `${options.provider} success`,
        usage: {
          inputTokens: 20,
          outputTokens: 10,
        },
        latencyMs: 1,
      };
    },
  } satisfies LlmProviderAdapter;
}

describe("model router", () => {
  it("falls back to next available provider and records degradation trace", async () => {
    const router = new ModelRouter([
      createAdapter({
        provider: "deepseekReasoner",
        model: "deepseek-reasoner",
        available: false,
      }),
      createAdapter({
        provider: "glm5",
        model: "glm-5",
        available: true,
        fail: true,
      }),
      createAdapter({
        provider: "qwen35Plus",
        model: "qwen3.5-plus",
        available: true,
      }),
    ]);

    const result = await router.complete({
      agentId: "dataUnderstanding",
      capability: "understanding",
      prompt: "test",
      context: {},
      preferredProviders: ["deepseekReasoner", "glm5", "qwen35Plus"],
    });

    expect(result.result.provider).toBe("qwen35Plus");
    expect(result.attempts.map((item) => item.status)).toEqual([
      "unavailable",
      "failed",
      "success",
    ]);
    expect(result.degradationTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "provider_unavailable",
          provider: "deepseekReasoner",
        }),
        expect.objectContaining({
          reason: "provider_failed",
          provider: "glm5",
        }),
      ]),
    );
  });

  it("throws model unavailable error when no provider can serve", async () => {
    const router = new ModelRouter([
      createAdapter({
        provider: "deepseekReasoner",
        model: "deepseek-reasoner",
        available: false,
      }),
    ]);

    await expect(
      router.complete({
        agentId: "expressionGeneration",
        capability: "expression",
        prompt: "test",
        context: {},
      }),
    ).rejects.toBeInstanceOf(ModelExecutionError);
  });

  it("probes individual providers for connectivity acceptance", async () => {
    const router = new ModelRouter([
      createAdapter({
        provider: "deepseekReasoner",
        model: "deepseek-reasoner",
        available: true,
      }),
      createAdapter({
        provider: "glm5",
        model: "glm-5",
        available: true,
        fail: true,
      }),
      createAdapter({
        provider: "qwen35Plus",
        model: "qwen3.5-plus",
        available: false,
      }),
    ]);

    const successProbe = await router.probeProvider("deepseekReasoner", {
      agentId: "taskOrchestrator",
      capability: "review",
      prompt: "probe",
      context: {},
      preferredProviders: ["deepseekReasoner"],
    });
    const failedProbe = await router.probeProvider("glm5", {
      agentId: "taskOrchestrator",
      capability: "retrieval",
      prompt: "probe",
      context: {},
      preferredProviders: ["glm5"],
    });
    const unavailableProbe = await router.probeProvider("qwen35Plus", {
      agentId: "taskOrchestrator",
      capability: "planning",
      prompt: "probe",
      context: {},
      preferredProviders: ["qwen35Plus"],
    });

    expect(successProbe.status).toBe("success");
    expect(successProbe.response?.provider).toBe("deepseekReasoner");
    expect(failedProbe.status).toBe("failed");
    expect(failedProbe.error).toContain("glm5 failed");
    expect(unavailableProbe.status).toBe("unavailable");
    expect(unavailableProbe.available).toBe(false);
  });
});

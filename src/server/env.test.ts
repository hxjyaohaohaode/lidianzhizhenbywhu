import { describe, expect, it } from "vitest";

import { resolveEnvFilePath } from "./env.js";

describe("server env loader", () => {
  it("prefers .env when it exists", () => {
    const cwd = "C:\\workspace\\battery";
    const fileExists = (filePath: string) => filePath === "C:\\workspace\\battery\\.env";

    expect(resolveEnvFilePath(cwd, fileExists)).toBe("C:\\workspace\\battery\\.env");
  });

  it("falls back to .env.example when .env is missing", () => {
    const cwd = "C:\\workspace\\battery";
    const fileExists = (filePath: string) => filePath === "C:\\workspace\\battery\\.env.example";

    expect(resolveEnvFilePath(cwd, fileExists)).toBe("C:\\workspace\\battery\\.env.example");
  });

  it("returns .env path when neither file exists", () => {
    expect(resolveEnvFilePath("C:\\workspace\\battery", () => false)).toBe("C:\\workspace\\battery\\.env");
  });
});

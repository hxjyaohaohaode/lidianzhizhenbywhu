import { mkdirSync } from "node:fs";
import { handler as expressHandler } from "./express-adapter.js";

export default async function (event, context) {
  if (process.env.NETLIFY) {
    process.env.STORAGE_DIR = "/tmp/platform";
    process.env.PERSISTENCE_MODE = "file";
    try { mkdirSync("/tmp/platform", { recursive: true }); } catch {}
  }
  return expressHandler(event, context);
};

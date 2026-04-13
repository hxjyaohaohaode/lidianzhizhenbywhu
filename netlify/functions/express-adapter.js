import { createApp } from "../../dist/server/server/app.js";
import { loadServerEnv } from "../../dist/server/server/env.js";
import { createLogger } from "../../dist/server/server/logger.js";

let app = null;

function getApp() {
  if (!app) {
    const env = loadServerEnv();
    const logger = createLogger(env);
    app = createApp({ env, logger });
  }
  return app;
}

export async function handler(event, context) {
  const expressApp = getApp();

  const path = event.rawUrl ? new URL(event.rawUrl).pathname : (event.path || "/");
  const method = event.httpMethod || "GET";
  const headers = event.headers || {};
  const body = event.body || "";
  const isBase64Encoded = event.isBase64Encoded || false;

  const decodedBody = isBase64Encoded
    ? Buffer.from(body, "base64").toString("utf-8")
    : body;

  const req = {
    method,
    url: path,
    path,
    headers,
    body: decodedBody,
    ip: headers["x-forwarded-for"] || headers["client-ip"] || "127.0.0.1",
    params: {},
    query: {},
  };

  try {
    const parsedUrl = new URL(event.rawUrl || `http://localhost${path}`);
    const searchParams = parsedUrl.searchParams;
    req.query = Object.fromEntries(searchParams.entries());
    req.url = parsedUrl.pathname + parsedUrl.search;
    req.path = parsedUrl.pathname;
  } catch {}

  if (decodedBody && headers["content-type"]?.includes("application/json")) {
    try { req.body = JSON.parse(decodedBody); } catch {}
  }

  const res = {
    statusCode: 200,
    headers: {},
    body: "",
    status(code) { this.statusCode = code; return this; },
    json(data) {
      this.headers["Content-Type"] = "application/json";
      this.body = JSON.stringify(data);
      return this;
    },
    send(data) {
      if (typeof data === "object") { this.json(data); }
      else { this.body = String(data); }
      return this;
    },
    setHeader(name, value) { this.headers[name] = value; return this; },
    getHeader(name) { return this.headers[name]; },
    end(data) { if (data) this.body = data; return this; },
    write(data) { this.body += data; return this; },
    flushHeaders() { return this; },
  };

  return new Promise((resolve) => {
    const mockReq = createMockRequest(method, path, headers, decodedBody, req.query, req.body);
    const mockRes = createMockResponse(resolve);

    expressApp(mockReq, mockRes, (err) => {
      if (err) {
        resolve({
          statusCode: err.statusCode || 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: { code: err.code || "INTERNAL_ERROR", message: err.message || "Internal Server Error" } }),
        });
      } else {
        resolve({
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: { code: "NOT_FOUND", message: "Not Found" } }),
        });
      }
    });
  });
}

function createMockRequest(method, path, headers, rawBody, query, parsedBody) {
  return {
    method,
    url: path,
    path,
    originalUrl: path,
    headers: headers || {},
    body: parsedBody || rawBody,
    rawBody,
    query: query || {},
    params: {},
    ip: headers?.["x-forwarded-for"] || "127.0.0.1",
    header(name) { return this.headers[name.toLowerCase()]; },
    get(name) { return this.header(name); },
    on(event, callback) {
      if (event === "data") { if (rawBody) callback(Buffer.from(rawBody)); }
      if (event === "end") { callback(); }
    },
    pipe(dest) { if (rawBody) dest.write(rawBody); dest.end(); return dest; },
  };
}

function createMockResponse(resolve) {
  let statusCode = 200;
  const responseHeaders = {};
  let body = "";
  let ended = false;

  const res = {
    statusCode: 200,
    status(code) { statusCode = code; this.statusCode = code; return this; },
    json(data) {
      responseHeaders["Content-Type"] = "application/json";
      body = JSON.stringify(data);
      if (!ended) { ended = true; finish(); }
      return this;
    },
    send(data) {
      if (typeof data === "object") return this.json(data);
      body = String(data ?? "");
      if (!ended) { ended = true; finish(); }
      return this;
    },
    end(data) {
      if (data) body += data;
      if (!ended) { ended = true; finish(); }
      return this;
    },
    write(data) { body += data; return this; },
    setHeader(name, value) { responseHeaders[name] = value; return this; },
    getHeader(name) { return responseHeaders[name]; },
    flushHeaders() { return this; },
    redirect(url) {
      statusCode = 302;
      responseHeaders["Location"] = url;
      if (!ended) { ended = true; finish(); }
      return this;
    },
    type(contentType) { responseHeaders["Content-Type"] = contentType; return this; },
    get writableEnded() { return ended; },
    get destroyed() { return false; },
    locals: {},
    on() { return this; },
    once() { return this; },
    emit() { return false; },
    removeListener() { return this; },
  };

  function finish() {
    resolve({
      statusCode,
      headers: responseHeaders,
      body,
    });
  }

  return res;
}

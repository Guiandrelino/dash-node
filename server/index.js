"use strict";
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { openDatabase, normalizePayload, PANELS } = require("./database");

const root = path.resolve(__dirname, "..");
function positiveInteger(value, fallback, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} deve ser um inteiro positivo`);
  return number;
}
const config = {
  host: process.env.HOST || "127.0.0.1",
  port: positiveInteger(process.env.PORT, 3000, "PORT"),
  url: process.env.NODE_RED_URL || "http://127.0.0.1:1880/api/dados",
  interval: positiveInteger(process.env.POLL_INTERVAL_MS, 1000, "POLL_INTERVAL_MS"),
  timeout: positiveInteger(process.env.REQUEST_TIMEOUT_MS, 8000, "REQUEST_TIMEOUT_MS"),
  database: path.resolve(root, process.env.DB_PATH || "data/energia.sqlite"),
};
const sourceUrl = new URL(config.url);
if (!["http:", "https:"].includes(sourceUrl.protocol)) throw new Error("NODE_RED_URL deve usar HTTP ou HTTPS");
fs.mkdirSync(path.dirname(config.database), { recursive: true });
const database = openDatabase(config.database);
const state = { connected: false, lastAttempt: null, lastSuccess: null, error: null };
let timer;
let controller;
let stopping = false;

async function collect() {
  state.lastAttempt = new Date().toISOString();
  controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeout);
  try {
    const response = await fetch(config.url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = typeof body?.erro === "string" ? `: ${body.erro.slice(0, 300)}` : "";
      throw new Error(`Node-RED respondeu HTTP ${response.status}${detail}`);
    }
    const panels = normalizePayload(await response.json());
    if (stopping) return;
    const timestamp = new Date().toISOString();
    database.save(panels, timestamp);
    state.connected = true;
    state.lastSuccess = timestamp;
    state.error = null;
  } catch (error) {
    state.connected = false;
    state.error = error.name === "AbortError" ? "Tempo limite ao consultar Node-RED" : error.message;
    if (!stopping) console.error(`[coleta] ${state.error}`);
  } finally {
    clearTimeout(timeout);
    controller = null;
    if (!stopping) timer = setTimeout(collect, config.interval);
  }
}

function json(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(data));
}
function dateFilter(value) {
  if (!value) return null;
  // Datas com timezone explícito evitam interpretação diferente entre máquinas.
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("Datas devem estar em ISO 8601 com timezone, por exemplo 2026-01-01T00:00:00Z");
  }
  return new Date(value).toISOString();
}
function integerQuery(value, fallback, min, max) {
  const number = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Paginação inválida: esperado inteiro entre ${min} e ${max}`);
  return number;
}

// Lista explícita: o banco, .env e arquivos do servidor nunca são públicos.
const staticFiles = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/css/styles.css": ["css/styles.css", "text/css; charset=utf-8"],
  "/js/app.js": ["js/app.js", "text/javascript; charset=utf-8"],
};
const server = http.createServer((request, response) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return json(response, 405, { erro: "Método não permitido" });
  }
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/api/status") return json(response, 200, state);
    if (url.pathname === "/api/dados") {
      const latest = database.latest();
      if (!latest) return json(response, 503, { erro: "Nenhuma leitura armazenada ainda", coleta: state });
      return json(response, 200, { ...latest, coleta: state });
    }
    if (url.pathname === "/api/historico") {
      let filters;
      try {
        const query = url.searchParams;
        const panel = query.get("setor");
        if (panel !== null && !PANELS.includes(panel)) throw new Error("Setor inválido");
        const start = dateFilter(query.get("inicio"));
        const end = dateFilter(query.get("fim"));
        if (start && end && start > end) throw new Error("inicio deve ser anterior ou igual a fim");
        filters = { panel, start, end,
          limit: integerQuery(query.get("limite"), 100, 1, 1000),
          offset: integerQuery(query.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER) };
      } catch (error) { return json(response, 400, { erro: error.message }); }
      return json(response, 200, { limite: filters.limit, offset: filters.offset, leituras: database.history(filters) });
    }
    const asset = staticFiles[url.pathname];
    if (!asset) return json(response, 404, { erro: "Não encontrado" });
    const contents = fs.readFileSync(path.join(root, asset[0]));
    response.writeHead(200, { "Content-Type": asset[1], "Cache-Control": "no-cache" });
    response.end(contents);
  } catch (error) {
    console.error("[http]", error);
    json(response, 500, { erro: "Erro interno do servidor" });
  }
});
server.listen(config.port, config.host, () => {
  console.log(`Dashboard: http://${config.host}:${config.port}`);
  console.log(`SQLite: ${config.database}`);
  collect();
});
function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  controller?.abort();
  server.close(() => { database.close(); });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

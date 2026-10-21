const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("HTTP coleta, persiste e sinaliza falha sem perder histórico", { timeout: 15000 }, async () => {
  let fail = false;
  const mock = http.createServer((req, res) => {
    if (fail) { res.writeHead(503); return res.end(); }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ paineis: { embalagem: { corrente1: 200, tensao1: 210, corrente2: 0, tensao2: 220, potencia1: 999 } } }));
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  const reserve = http.createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const port = reserve.address().port;
  await new Promise(resolve => reserve.close(resolve));
  const directory = mkdtempSync(path.join(tmpdir(), "volt-test-"));
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_RED_URL: `http://127.0.0.1:${mock.address().port}/api/dados`, POLL_INTERVAL_MS: "50", DB_PATH: path.join(directory, "test.sqlite") },
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}`;
  async function waitFor(check) {
    for (let i = 0; i < 100; i++) {
      try { if (await check()) return; } catch {}
      await sleep(50);
    }
    throw new Error("Tempo limite aguardando backend");
  }
  try {
    await waitFor(async () => (await fetch(`${base}/api/dados`)).ok);
    const latest = await (await fetch(`${base}/api/dados`)).json();
    assert.equal(latest.paineis.embalagem.potencia1, 42000);
    assert.equal(latest.paineis.embalagem.potencia2, 0);
    assert.equal(latest.coleta.connected, true);
    assert.equal((await fetch(`${base}/`)).status, 200);
    for (const asset of ["/css/styles.css", "/js/app.js"]) {
      assert.equal((await fetch(`${base}${asset}`)).status, 200);
    }
    for (const privatePath of ["/data/energia.sqlite", "/.env", "/.git/config", "/server/index.js", "/fluxo.json"]) {
      assert.equal((await fetch(`${base}${privatePath}`)).status, 404, privatePath);
    }
    const methodDenied = await fetch(`${base}/api/dados`, { method: "POST" });
    assert.equal(methodDenied.status, 405);
    assert.equal(methodDenied.headers.get("allow"), "GET");
    const statusResponse = await fetch(`${base}/api/status`);
    assert.equal(statusResponse.headers.get("cache-control"), "no-store");
    assert.equal(statusResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await fetch(`${base}/api/historico?setor=invalid`)).status, 400);
    for (const query of [
      "limite=-1", "limite=1001", "offset=-1", "offset=1.5",
      "inicio=2026-01-01", "fim=invalido",
      "inicio=2026-02-01T00:00:00Z&fim=2026-01-01T00:00:00Z",
    ]) {
      assert.equal((await fetch(`${base}/api/historico?${query}`)).status, 400, query);
    }
    const history = await (await fetch(`${base}/api/historico?setor=embalagem&limite=1`)).json();
    assert.equal(history.leituras.length, 1);
    assert.equal(history.leituras[0].potencia1, 42000);
    fail = true;
    await waitFor(async () => !(await (await fetch(`${base}/api/status`)).json()).connected);
    const stale = await (await fetch(`${base}/api/dados`)).json();
    assert.equal(stale.paineis.embalagem.potencia1, 42000);
    assert.equal(stale.coleta.connected, false);
  } finally {
    const exit = once(child, "exit");
    child.kill();
    await exit;
    await new Promise(resolve => mock.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});

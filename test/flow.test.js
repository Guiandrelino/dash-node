const { test: nodeTest } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { normalizePayload, openDatabase } = require("../server/database");
const flowPath = path.join(__dirname, "../fluxo.json");
const hasLocalFlow = fs.existsSync(flowPath);
const nodes = hasLocalFlow ? JSON.parse(fs.readFileSync(flowPath, "utf8")) : [];
// O fluxo é privado e não está disponível no clone público ou no CI.
const test = (name, fn) => nodeTest(name, { skip: hasLocalFlow ? false : "Fluxo Node-RED local não disponível" }, fn);
const api = nodes.find(node => node.id === "d5cbe38c9cefe14f");
function context() {
  const store = new Map();
  return { flow: { get: key => store.get(key), set: (key, value) => store.set(key, value) }, store };
}
function run(code, flow, msg) {
  return vm.runInNewContext(`(function(){${code}\n})()`, { flow, msg, Buffer, Date, node: { warn() {}, status() {} } });
}
function registers(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeFloatBE(value);
  return [buffer.readUInt16BE(0), buffer.readUInt16BE(2)];
}

test("todos os conversores alimentam API e banco, calculando potências e mantendo zeros", () => {
  const { flow } = context();
  const reads = nodes.filter(node => node.type === "modbus-read");
  assert.equal(reads.length, 20);
  for (const read of reads) {
    const converter = nodes.find(node => node.id === read.wires[0][0]);
    run(converter.func, flow, { payload: registers(read.topic === "embalagem/corrente1" ? 0 : 12.5) });
  }
  const result = run(api.func, flow, { req: {}, res: {} });
  assert.equal(result.statusCode, 200);
  const panels = normalizePayload(result.payload);
  assert.equal(Object.keys(panels).length, 5);
  assert.equal(panels.embalagem.corrente1, 0);
  assert.equal(panels.entrega.tensao2, 12.5);
  assert.equal(result.payload.paineis.embalagem.potencia1, null);
  const db = openDatabase(":memory:");
  try {
    db.save(panels);
    assert.equal(db.history({ limit: 100, offset: 0 }).length, 5);
    assert.equal(db.latest().paineis.embalagem.potencia1, 0);
    assert.equal(db.latest().paineis.embalagem.potencia2, 156.25);
  } finally { db.close(); }
});

test("API retorna 503 antes de receber dados e descarta campos antigos individualmente", () => {
  const { flow } = context();
  assert.equal(run(api.func, flow, {}).statusCode, 503);
  flow.set("paineis", { entrega: { corrente1: 10, tensao1: 220 } });
  flow.set("leiturasAtualizadasEm", { entrega: { corrente1: Date.now() - 20000, tensao1: Date.now() } });
  const result = run(api.func, flow, {});
  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.paineis.entrega.corrente1, null);
  assert.equal(result.payload.paineis.entrega.tensao1, 220);
});

test("conversão ignora registradores inválidos e aceita payload.data", () => {
  const { flow } = context();
  const converter = nodes.find(node => node.id === "65735bf6ee2ff11d");
  assert.equal(run(converter.func, flow, { payload: [] }), null);
  assert.equal(run(converter.func, flow, { payload: [-1, 0] }), null);
  assert.equal(run(converter.func, flow, { payload: registers(Infinity) }), null);
  const result = run(converter.func, flow, { payload: { data: registers(1.25) } });
  assert.equal(result.payload, 1.25);
});

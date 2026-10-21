"use strict";
// Reconstrói o fluxo corrigido a partir do backup original, sem alterar o mapa Modbus.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const originalPath = path.join(root, "fluxo.original.json");
if (!fs.existsSync(originalPath)) {
  console.error("fluxo.original.json não encontrado. Este arquivo é local e não acompanha o repositório; obtenha o backup do seu ambiente antes de executar este script.");
  process.exit(1);
}
const nodes = JSON.parse(fs.readFileSync(originalPath, "utf8"));
const panels = ["embalagem", "entrega", "qualidade", "usinagem", "montagem"];
const fields = ["corrente1", "corrente2", "tensao1", "tensao2", "potencia1", "potencia2"];

for (const read of nodes.filter(node => node.type === "modbus-read")) {
  const match = read.name.match(/^(Corrente|Tensão)\s*([12]) Painel (.+)$/);
  if (!match) throw new Error(`Medição não reconhecida: ${read.name}`);
  const panel = match[3].toLowerCase();
  const field = `${match[1] === "Corrente" ? "corrente" : "tensao"}${match[2]}`;
  const converter = nodes.find(node => node.id === read.wires[0][0]);
  if (!converter || converter.type !== "function") throw new Error(`Conversor ausente: ${read.name}`);
  read.topic = `${panel}/${field}`;
  read.showErrors = true;
  converter.name = `Converter e salvar ${panel}/${field}`;
  converter.initialize = '// Descarta caches antigos ao implantar o fluxo.\nflow.set("paineis", {});\nflow.set("leiturasAtualizadasEm", {});';
  converter.func = `// Preserva a ordem de palavras e as unidades do fluxo original.
// Corrente esperada em A; confirme a unidade no manual do medidor.
const WORD_SWAP = false;
const SCALE = 1;
const PANEL = ${JSON.stringify(panel)};
const FIELD = ${JSON.stringify(field)};
const UNIT = ${JSON.stringify(field.startsWith("corrente") ? "A" : "V")};
const p = Array.isArray(msg.payload) ? msg.payload : msg.payload && msg.payload.data;
if (!Array.isArray(p) || p.length < 2 ||
    !p.slice(0, 2).every(v => Number.isInteger(v) && v >= 0 && v <= 65535)) {
    node.warn("Registradores inválidos: " + PANEL + "/" + FIELD);
    return null;
}
const buffer = Buffer.alloc(4);
buffer.writeUInt16BE(p[WORD_SWAP ? 1 : 0], 0);
buffer.writeUInt16BE(p[WORD_SWAP ? 0 : 1], 2);
const value = buffer.readFloatBE(0) * SCALE;
if (!Number.isFinite(value)) {
    node.warn("Float32 inválido: " + PANEL + "/" + FIELD);
    return null;
}
const rounded = Number(value.toFixed(${field.startsWith("corrente") ? 3 : 2}));
const paineis = flow.get("paineis") || {};
const updates = flow.get("leiturasAtualizadasEm") || {};
paineis[PANEL] = paineis[PANEL] || {};
updates[PANEL] = updates[PANEL] || {};
paineis[PANEL][FIELD] = rounded;
updates[PANEL][FIELD] = Date.now();
flow.set("paineis", paineis);
flow.set("leiturasAtualizadasEm", updates);
msg.payload = rounded;
msg.topic = PANEL + "/" + FIELD;
msg.unit = UNIT;
node.status({ fill: "green", shape: "dot", text: rounded + " " + UNIT });
return msg;`;
}

const api = nodes.find(node => node.id === "d5cbe38c9cefe14f");
api.name = "API: snapshot de leituras recentes";
api.func = `// Nunca apresenta o horário da consulta como se fosse o horário da medição.
const MAX_AGE_MS = 15000;
const now = Date.now();
const cached = flow.get("paineis") || {};
const updates = flow.get("leiturasAtualizadasEm") || {};
const paineis = {};
const leiturasAtualizadasEm = {};
let validCount = 0;
let lastReading = 0;
for (const panel of ${JSON.stringify(panels)}) {
    paineis[panel] = {};
    leiturasAtualizadasEm[panel] = {};
    for (const field of ${JSON.stringify(fields)}) {
        const value = cached[panel] && cached[panel][field];
        const timestamp = updates[panel] && updates[panel][field];
        const valid = typeof value === "number" && Number.isFinite(value) &&
            typeof timestamp === "number" && now >= timestamp && now - timestamp <= MAX_AGE_MS;
        paineis[panel][field] = valid ? value : null;
        leiturasAtualizadasEm[panel][field] = valid ? new Date(timestamp).toISOString() : null;
        if (valid) { validCount++; lastReading = Math.max(lastReading, timestamp); }
    }
}
msg.statusCode = validCount ? 200 : 503;
msg.payload = {
    timestamp: lastReading ? new Date(lastReading).toISOString() : null,
    consultadoEm: new Date(now).toISOString(),
    paineis,
    leiturasAtualizadasEm,
    ...(validCount ? {} : { erro: "Sem leituras Modbus recentes. Verifique conexão TCP, IDs dos dispositivos e registradores." })
};
msg.headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
return msg;`;
nodes.find(node => node.type === "http in").name = "GET /api/dados";
const tab = nodes.find(node => node.type === "tab");
tab.label = "Energia — Modbus e API";
tab.info = "Conversores salvam valores e horários no contexto do fluxo. GET /api/dados expõe somente leituras recebidas nos últimos 15 segundos. Potências não são medidas neste fluxo; permanecem null. Endereços e escala originais preservados: confirme o manual do medidor antes de alterar.";
nodes.push({
  id: "volt-flow-notes", type: "comment", z: tab.id,
  name: "API corrigida: valores no contexto + validade de 15 s. Potências sem leitura.",
  info: "Backend: npm start, dashboard http://127.0.0.1:3000. Teste primeiro http://127.0.0.1:1880/api/dados. Não importe o backup junto com o fluxo corrigido. Endereço 3023 em Tensão2 Entrega foi preservado; confira no manual pois os demais setores usam 3021. Correntes mantêm escala original (SCALE=1).",
  x: 1550, y: 900, wires: [],
});
fs.writeFileSync(path.join(root, "fluxo.json"), JSON.stringify(nodes, null, 4) + "\n");
console.log("fluxo.json corrigido: 20 conversores, contexto compartilhado e API com validade por campo.");

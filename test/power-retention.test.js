const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { openDatabase, normalizePayload } = require("../server/database");

function sample(index) {
  return normalizePayload({ paineis: {
    embalagem: { corrente1: index, tensao1: 200, corrente2: index * 2, tensao2: 300, potencia1: 999 },
    entrega: { corrente1: index, tensao1: 100 },
  } });
}

test("potência usa pares da mesma linha, usa corrente em A e mantém ausências", () => {
  const db = openDatabase(":memory:");
  try {
    db.save(sample(100));
    const values = db.latest().paineis;
    assert.equal(values.embalagem.potencia1, 20000);
    assert.equal(values.embalagem.potencia2, 60000);
    assert.equal(values.entrega.potencia1, 10000);
    assert.equal(values.entrega.potencia2, null);
    db.save(normalizePayload({ paineis: { embalagem: { corrente1: 0, tensao1: 220, corrente2: 10 } } }));
    assert.equal(db.latest().paineis.embalagem.potencia1, 0);
    assert.equal(db.latest().paineis.embalagem.potencia2, null);
    assert.throws(() => normalizePayload({ paineis: { embalagem: { potencia1: 50 } } }));
  } finally { db.close(); }
});

test("mantém 100 coletas por lote e limpa o anterior ao iniciar o próximo", () => {
  const db = openDatabase(":memory:");
  try {
    for (let i = 1; i <= 100; i++) db.save(sample(i));
    assert.equal(db.history({ panel: "embalagem", limit: 1000, offset: 0 }).length, 100);
    assert.equal(db.history({ limit: 1000, offset: 0 }).length, 200);
    // Falha na inserção não pode apagar o lote anterior.
    assert.throws(() => db.save({ entrega: {} }));
    assert.equal(db.history({ limit: 1000, offset: 0 }).length, 200);
    db.save(sample(101));
    const rows = db.history({ limit: 1000, offset: 0 });
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.corrente1 === 101));
    for (let i = 102; i <= 200; i++) db.save(sample(i));
    assert.equal(db.history({ panel: "embalagem", limit: 1000, offset: 0 }).length, 100);
    db.save(sample(201));
    assert.equal(db.history({ limit: 1000, offset: 0 }).length, 2);
  } finally { db.close(); }
});

test("reabertura mantém contagem do lote e adapta bancos existentes", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "volt-retention-"));
  const filename = path.join(directory, "test.sqlite");
  let db;
  try {
    db = openDatabase(filename);
    db.save(sample(1));
    db.close();
    const raw = new DatabaseSync(filename);
    raw.exec(`
      UPDATE leituras SET potencia1 = 999;
      WITH RECURSIVE n(x) AS (SELECT 2 UNION ALL SELECT x+1 FROM n WHERE x<150)
      INSERT INTO coletas(id, coletado_em) SELECT x, '2026-01-01T00:00:00.000Z' FROM n;
      INSERT INTO leituras(coleta_id, setor, corrente1, tensao1, potencia1)
      SELECT id, 'embalagem', id, 200, 999 FROM coletas WHERE id > 1;
    `);
    raw.close();
    db = openDatabase(filename);
    const rows = db.history({ limit: 1000, offset: 0 });
    assert.equal(rows.length, 100);
    assert.equal(rows[0].potencia1, 30000);
    assert.equal(rows[99].corrente1, 51);
    db.save(sample(151));
    assert.equal(db.history({ limit: 1000, offset: 0 }).length, 2);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

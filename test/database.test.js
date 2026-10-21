const { test } = require("node:test");
const assert = require("node:assert/strict");
const { openDatabase, normalizePayload } = require("../server/database");

test("normaliza valores e rejeita respostas sem leituras", () => {
  const panels = normalizePayload({ paineis: { embalagem: { corrente1: 0, corrente2: "12.5", tensao1: "", tensao2: true, potencia1: "erro" } } });
  assert.equal(panels.embalagem.corrente1, 0);
  assert.equal(panels.embalagem.corrente2, 12.5);
  assert.equal(panels.embalagem.tensao1, null);
  assert.equal(panels.embalagem.tensao2, null);
  assert.throws(() => normalizePayload({ paineis: {} }));
  assert.throws(() => normalizePayload({ paineis: [] }));
});

test("salva snapshots, consulta último e filtra histórico", () => {
  const db = openDatabase(":memory:");
  try {
    assert.equal(db.latest(), null);
    const panels = normalizePayload({ paineis: { embalagem: { corrente1: 100, tensao1: 200 }, entrega: { corrente1: 150, tensao1: 200 } } });
    db.save(panels, "2026-01-01T00:00:00.000Z");
    db.save(panels, "2026-01-02T00:00:00.000Z");
    assert.equal(db.latest().coletadoEm, "2026-01-02T00:00:00.000Z");
    assert.equal(db.latest().paineis.entrega.potencia1, 30000);
    assert.equal(db.history({ limit: 100, offset: 0 }).length, 4);
    assert.equal(db.history({ panel: "embalagem", start: "2026-01-02T00:00:00.000Z", limit: 100, offset: 0 }).length, 1);
    assert.equal(db.history({ limit: 1, offset: 1 }).length, 1);
    assert.throws(() => db.save({ entrega: {} }));
    assert.equal(db.history({ limit: 100, offset: 0 }).length, 4);
  } finally { db.close(); }
});

"use strict";
const { DatabaseSync } = require("node:sqlite");

const PANELS = ["embalagem", "entrega", "qualidade", "usinagem", "montagem"];
const FIELDS = ["corrente1", "corrente2", "tensao1", "tensao2", "potencia1", "potencia2"];
const INPUT_FIELDS = ["corrente1", "corrente2", "tensao1", "tensao2"];
const COLLECTION_LIMIT = 100;
// Corrente já em A: V × A. Cada par vem da mesma linha.
const CALCULATE_POWER_SQL = `UPDATE leituras SET
  potencia1 = tensao1 * corrente1,
  potencia2 = tensao2 * corrente2`;

function normalizePayload(payload) {
  if (!payload || !payload.paineis || typeof payload.paineis !== "object" || Array.isArray(payload.paineis)) {
    throw new Error("Resposta inválida: esperado objeto paineis");
  }
  const panels = {};
  for (const panel of PANELS) {
    const source = payload.paineis[panel];
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    const values = {};
    for (const field of INPUT_FIELDS) {
      const value = source[field];
      const validType = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
      values[field] = validType && Number.isFinite(Number(value)) ? Number(value) : null;
    }
    if (Object.values(values).some(value => value !== null)) panels[panel] = values;
  }
  if (!Object.keys(panels).length) throw new Error("Resposta sem medições válidas");
  return panels;
}

function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS coletas (
      id INTEGER PRIMARY KEY,
      coletado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS leituras (
      id INTEGER PRIMARY KEY,
      coleta_id INTEGER NOT NULL REFERENCES coletas(id),
      setor TEXT NOT NULL,
      corrente1 REAL, corrente2 REAL, tensao1 REAL, tensao2 REAL,
      potencia1 REAL, potencia2 REAL,
      UNIQUE(coleta_id, setor)
    );
    CREATE INDEX IF NOT EXISTS idx_coletas_data ON coletas(coletado_em);
    CREATE INDEX IF NOT EXISTS idx_leituras_setor_coleta ON leituras(setor, coleta_id);
  `);
  const insertCollection = db.prepare("INSERT INTO coletas(coletado_em) VALUES (?)");
  const insertReading = db.prepare(`INSERT INTO leituras(coleta_id, setor, ${INPUT_FIELDS.join(",")}) VALUES (?, ?, ?, ?, ?, ?)`);
  const calculatePower = db.prepare(`${CALCULATE_POWER_SQL} WHERE coleta_id = ?`);
  const collectionCount = db.prepare("SELECT COUNT(*) AS total FROM coletas");

  // Adequa bancos existentes ao limite e recalcula o histórico já armazenado.
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      DELETE FROM leituras WHERE coleta_id NOT IN (SELECT id FROM coletas ORDER BY id DESC LIMIT ${COLLECTION_LIMIT});
      DELETE FROM coletas WHERE id NOT IN (SELECT id FROM coletas ORDER BY id DESC LIMIT ${COLLECTION_LIMIT});
      ${CALCULATE_POWER_SQL};
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }

  return {
    save(panels, timestamp = new Date().toISOString()) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (collectionCount.get().total >= COLLECTION_LIMIT) {
          // Remove primeiro as linhas filhas para respeitar as chaves estrangeiras.
          db.exec("DELETE FROM leituras; DELETE FROM coletas;");
        }
        const id = insertCollection.run(timestamp).lastInsertRowid;
        for (const [panel, values] of Object.entries(panels)) {
          insertReading.run(id, panel, ...INPUT_FIELDS.map(field => values[field]));
        }
        // Calcula somente depois de persistir corrente e tensão no SQLite.
        calculatePower.run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    latest() {
      const collection = db.prepare("SELECT id, coletado_em FROM coletas ORDER BY id DESC LIMIT 1").get();
      if (!collection) return null;
      const panels = {};
      for (const row of db.prepare("SELECT * FROM leituras WHERE coleta_id = ?").all(collection.id)) {
        panels[row.setor] = Object.fromEntries(FIELDS.map(field => [field, row[field]]));
      }
      return { coletadoEm: collection.coletado_em, paineis: panels };
    },
    history({ panel, start, end, limit, offset }) {
      const clauses = [];
      const args = [];
      if (panel) { clauses.push("l.setor = ?"); args.push(panel); }
      if (start) { clauses.push("c.coletado_em >= ?"); args.push(start); }
      if (end) { clauses.push("c.coletado_em <= ?"); args.push(end); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
      return db.prepare(`SELECT l.*, c.coletado_em FROM leituras l JOIN coletas c ON c.id = l.coleta_id ${where} ORDER BY c.id DESC, l.id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    },
    close() { db.close(); },
  };
}

module.exports = { openDatabase, normalizePayload, PANELS };

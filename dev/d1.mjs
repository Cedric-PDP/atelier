// D1 simulée au-dessus de node:sqlite (Node 22.13+), pour le serveur local et les tests.
// Reprend ce que l'API utilise : prepare / bind / first / all / run / raw, batch (transaction), exec.

import { DatabaseSync } from 'node:sqlite';

// D1 refuse undefined et range les booléens en 0/1 ; node:sqlite refuse les booléens.
function toSql(value, i) {
  if (value === undefined) throw new TypeError(`D1_TYPE_ERROR : paramètre ${i + 1} undefined`);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

const plain = (row) => ({ ...row });

class Statement {
  constructor(d1, sql, params = []) {
    this.d1 = d1;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.d1, this.sql, params.map(toSql));
  }

  // Exécute et renvoie un résultat au format D1 : {results, success, meta}.
  _exec() {
    const db = this.d1.sqlite;
    const start = performance.now();
    const cpu0 = process.cpuUsage();
    // all() exécute aussi les écritures (et rend les lignes d'un RETURNING).
    // node:sqlite prend les paramètres numérotés (?1, ?2…) pour des paramètres nommés : on les lui passe par nom.
    const args = /\?\d/.test(this.sql)
      ? [Object.fromEntries(this.params.map((v, i) => [`?${i + 1}`, v]))]
      : this.params;
    const results = db.prepare(this.sql).all(...args).map(plain);
    const write = !/^\s*(SELECT|WITH|PRAGMA)\b/i.test(this.sql);
    const meta = write ? db.prepare('SELECT changes() AS changes, last_insert_rowid() AS last_row_id').get() : {};
    // Temps passé dans SQLite, pour les mesures des tests : écoulé, et CPU (par pas de 15,6 ms sous Windows).
    this.d1.sqlMs += performance.now() - start;
    const cpu = process.cpuUsage(cpu0);
    this.d1.sqlCpuMs += (cpu.user + cpu.system) / 1000;
    return {
      results,
      success: true,
      meta: {
        changes: write ? meta.changes : 0,
        last_row_id: write ? meta.last_row_id : 0,
        rows_read: results.length,
        duration: performance.now() - start,
      },
    };
  }

  async all() {
    return this._exec();
  }

  async run() {
    return this._exec();
  }

  async first(column) {
    const row = this._exec().results[0];
    if (!row) return null;
    return column === undefined ? row : (row[column] ?? null);
  }

  async raw() {
    return this._exec().results.map((r) => Object.values(r));
  }
}

export class D1Shim {
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
    this.sqlMs = 0;
    this.sqlCpuMs = 0;
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  // Comme D1 : toutes les requêtes dans une transaction, annulée entière si l'une échoue.
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const out = statements.map((s) => s._exec());
      this.sqlite.exec('COMMIT');
      return out;
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(sql) {
    this.sqlite.exec(sql);
    return { count: 1, duration: 0 };
  }

  close() {
    this.sqlite.close();
  }
}

export function createD1(path) {
  return new D1Shim(path);
}

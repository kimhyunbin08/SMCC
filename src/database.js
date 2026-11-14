import { DatabaseSync } from 'node:sqlite';

export class StoreConflict extends Error {}
export class StoreUnavailable extends Error {}

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records (
      namespace TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
      PRIMARY KEY(namespace,id)
    );`);
  const read = db.prepare('SELECT value FROM records WHERE namespace=? AND id=?');
  const insert = db.prepare('INSERT INTO records VALUES(?,?,?)');
  const write = db.prepare('UPDATE records SET value=? WHERE namespace=? AND id=?');
  const remove = db.prepare('DELETE FROM records WHERE namespace=? AND id=?');
  return {
    kind: 'sqlite',
    async get(namespace, id) { const row = read.get(namespace, id); return row ? JSON.parse(row.value) : null; },
    async list(namespace) { return db.prepare('SELECT value FROM records WHERE namespace=?').all(namespace).map((row) => JSON.parse(row.value)); },
    async create(namespace, id, value) {
      try { insert.run(namespace, id, JSON.stringify(value)); }
      catch (error) {
        if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE')) throw new StoreConflict();
        throw error;
      }
      return value;
    },
    async mutate(namespace, id, change) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = read.get(namespace, id), current = row ? JSON.parse(row.value) : null;
        const value = change(current);
        if (value === null) remove.run(namespace, id);
        else if (row) write.run(JSON.stringify(value), namespace, id);
        else insert.run(namespace, id, JSON.stringify(value));
        db.exec('COMMIT');
        return value;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async remove(namespace, id) { remove.run(namespace, id); },
    async check() { db.prepare('SELECT 1').get(); },
    close() { db.close(); },
  };
}

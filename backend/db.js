const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SQLITE_FILE = path.join(DATA_DIR, 'stores.sqlite3');
const SEED_JSON = path.join(DATA_DIR, 'stores.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadSeed() {
  try {
    if (fs.existsSync(SEED_JSON)) {
      return JSON.parse(fs.readFileSync(SEED_JSON, 'utf-8'));
    }
  } catch {}
  return [];
}

// Try to initialize SQLite using better-sqlite3; fallback to JSON file if not available
let mode = 'json';
let sql = null;

ensureDataDir();

try {
  const Database = require('better-sqlite3');
  sql = new Database(SQLITE_FILE);
  mode = 'sqlite';

  sql.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      phone TEXT,
      hours TEXT,
      description TEXT
    );
  `);

  const columnInfo = sql.prepare('PRAGMA table_info(stores)').all();
  const existingColumns = new Set(columnInfo.map((c) => c.name));
  const ensureColumn = (name, type) => {
    if (!existingColumns.has(name)) {
      sql.prepare(`ALTER TABLE stores ADD COLUMN ${name} ${type}`).run();
      existingColumns.add(name);
    }
  };

  ensureColumn('phone', 'TEXT');
  ensureColumn('hours', 'TEXT');
  ensureColumn('description', 'TEXT');

  const count = sql.prepare('SELECT COUNT(*) AS c FROM stores').get().c;
  if (count === 0) {
    const seed = loadSeed();
    const insert = sql.prepare(
      'INSERT INTO stores (name, category, address, lat, lng, phone, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const tx = sql.transaction((rows) => {
      for (const r of rows) {
        insert.run(
          r.name,
          r.category,
          r.address,
          r.lat,
          r.lng,
          r.phone || null,
          r.hours || null,
          r.description || null
        );
      }
    });
    tx(seed);
  }
} catch (e) {
  mode = 'json';
}

// JSON fallback helpers
const JSON_FILE = path.join(DATA_DIR, 'stores.json');
function readJsonStores() {
  try {
    const raw = fs.readFileSync(JSON_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    const seed = loadSeed();
    fs.writeFileSync(JSON_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
}
function writeJsonStores(stores) {
  fs.writeFileSync(JSON_FILE, JSON.stringify(stores, null, 2), 'utf-8');
}

module.exports = {
  mode,
  list() {
    if (mode === 'sqlite') {
      return sql
        .prepare('SELECT id, name, category, address, lat, lng, phone, hours, description FROM stores ORDER BY id ASC')
        .all();
    }
    return readJsonStores();
  },
  random(count = 8) {
    if (mode === 'sqlite') {
      return sql
        .prepare('SELECT id, name, category, address, lat, lng, phone, hours, description FROM stores ORDER BY RANDOM() LIMIT ?')
        .all(count);
    }
    const stores = readJsonStores();
    const shuffled = [...stores].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
  },
  search(q) {
    if (!q) return this.list();
    if (mode === 'sqlite') {
      const like = `%${q.toLowerCase()}%`;
      return sql
        .prepare(
          'SELECT id, name, category, address, lat, lng, phone, hours, description FROM stores WHERE LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(address) LIKE ? ORDER BY id ASC'
        )
        .all(like, like, like);
    }
    const searchQuery = q.toLowerCase();
    return readJsonStores().filter(
      (s) =>
        s.name.toLowerCase().includes(searchQuery) ||
        s.category.toLowerCase().includes(searchQuery) ||
        s.address.toLowerCase().includes(searchQuery)
    );
  },
  get(id) {
    if (mode === 'sqlite') {
      return sql
        .prepare('SELECT id, name, category, address, lat, lng, phone, hours, description FROM stores WHERE id = ?')
        .get(id);
    }
    return readJsonStores().find((s) => s.id === id);
  },
  add({ name, category, address, lat, lng, phone = null, hours = null, description = null }) {
    if (mode === 'sqlite') {
      const info = sql
        .prepare(
          'INSERT INTO stores (name, category, address, lat, lng, phone, hours, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(name, category, address, lat, lng, phone, hours, description);
      return this.get(info.lastInsertRowid);
    }
    const stores = readJsonStores();
    const nextId = stores.length ? Math.max(...stores.map((s) => s.id || 0)) + 1 : 1;
    const newStore = {
      id: nextId,
      name,
      category,
      address,
      lat,
      lng,
      phone: phone || null,
      hours: hours || null,
      description: description || null,
    };
    stores.push(newStore);
    writeJsonStores(stores);
    return newStore;
  },
  remove(id) {
    if (!Number.isInteger(id)) return false;
    if (mode === 'sqlite') {
      const result = sql.prepare('DELETE FROM stores WHERE id = ?').run(id);
      return result.changes > 0;
    }
    const stores = readJsonStores();
    const next = stores.filter((s) => s.id !== id);
    if (next.length === stores.length) return false;
    writeJsonStores(next);
    return true;
  },
};

import * as SQLite from 'expo-sqlite';
import { runMigrations } from './migrations';

const DB_NAME = 'medireach.db';

let _db: SQLite.SQLiteDatabase | null = null;

export function getDb(): SQLite.SQLiteDatabase {
  if (!_db) {
    try {
      _db = SQLite.openDatabaseSync(DB_NAME);
    } catch (e) {
      // expo-sqlite native module unavailable (Expo Go without dev build)
      // Return a no-op proxy so callers don't crash
      _db = createNoOpDb();
    }
  }
  return _db;
}

export async function initDatabase(): Promise<void> {
  try {
    const db = getDb();
    await runMigrations(db);
  } catch {
    // Silent — app will function without persistence in Expo Go
  }
}

// Minimal no-op that satisfies the SQLiteDatabase interface used by queries.ts
function createNoOpDb(): SQLite.SQLiteDatabase {
  const noop = async () => undefined;
  return {
    execAsync: noop,
    runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
    closeSync: () => undefined,
  } as unknown as SQLite.SQLiteDatabase;
}

import * as SQLite from 'expo-sqlite';

export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS user_profile (
      id            TEXT PRIMARY KEY DEFAULT 'local_user',
      full_name     TEXT NOT NULL,
      phone         TEXT NOT NULL,
      cnic          TEXT NOT NULL,
      lat           REAL,
      lng           REAL,
      registered_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_payloads (
      case_id        TEXT PRIMARY KEY,
      encrypted_blob TEXT NOT NULL,
      triage_level   TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      attempts       INTEGER DEFAULT 0,
      last_attempt   INTEGER
    );

    CREATE TABLE IF NOT EXISTS completed_cases (
      case_id         TEXT PRIMARY KEY,
      triage_level    TEXT NOT NULL,
      chief_complaint TEXT NOT NULL,
      completed_at    INTEGER NOT NULL,
      acknowledged    INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

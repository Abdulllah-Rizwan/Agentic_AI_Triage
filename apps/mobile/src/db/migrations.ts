import * as SQLite from 'expo-sqlite';

export async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  // ── v0 → initial schema ───────────────────────────────────────────────────
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

  // ── v1 → add password_hash to user_profile ───────────────────────────────
  // PRAGMA user_version tracks which migrations have been applied.
  const versionRow = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const dbVersion = versionRow?.user_version ?? 0;

  if (dbVersion < 1) {
    try {
      await db.execAsync('ALTER TABLE user_profile ADD COLUMN password_hash TEXT');
    } catch {
      // Column already exists on fresh installs where the table was created above
    }
    await db.execAsync('PRAGMA user_version = 1');
  }
}

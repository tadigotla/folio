import Database from 'better-sqlite3';
import { afterEach, beforeEach, vi } from 'vitest';
import {
  clearDbForTest,
  runMigrations,
  setDbForTest,
} from '../db';

/**
 * Per-test in-memory SQLite. Each test gets a fresh database with all
 * migrations applied, then disposed in afterEach. Tests SHALL NOT touch the
 * on-disk events.db.
 */
export function setupInMemoryDb(): { db: () => Database.Database } {
  let current: Database.Database | null = null;

  beforeEach(() => {
    current = new Database(':memory:');
    current.pragma('foreign_keys = ON');
    setDbForTest(current);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      runMigrations();
    } finally {
      logSpy.mockRestore();
    }
  });

  afterEach(() => {
    if (current) {
      current.close();
      current = null;
    }
    clearDbForTest();
  });

  return {
    db: () => {
      if (!current) throw new Error('test db not initialized');
      return current;
    },
  };
}

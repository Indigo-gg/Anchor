import { app, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import { join } from 'path';
import { logger, LogCategory } from './logger';

export function setupDatabase(): Database.Database {
  try {
    const dbPath = join(app.getPath('userData'), 'anchor-memory.db');
    logger.info(LogCategory.FILE, `Initializing SQLite database at: ${dbPath}`);
    const db = new Database(dbPath);

    // Initial table setup
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT,
        roleId TEXT,
        content TEXT,
        tags TEXT,
        embedding TEXT,
        confidence REAL,
        source TEXT,
        createdAt INTEGER,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_roleId ON memories(roleId);
    `);

    // IPC Handlers
    ipcMain.handle('db:getMemories', (_event, roleId: string) => {
      try {
        const stmt = db.prepare('SELECT * FROM memories WHERE roleId = ? ORDER BY createdAt DESC');
        return stmt.all(roleId);
      } catch (e: any) {
        logger.error(LogCategory.FILE, `db:getMemories Error: ${e.message}`, e);
        throw e;
      }
    });

    ipcMain.handle('db:addMemory', (_event, memory: any) => {
      try {
        const stmt = db.prepare(`
          INSERT INTO memories (id, type, roleId, content, tags, embedding, confidence, source, createdAt, metadata)
          VALUES (@id, @type, @roleId, @content, @tags, @embedding, @confidence, @source, @createdAt, @metadata)
        `);
        stmt.run({
          ...memory,
          tags: memory.tags ? JSON.stringify(memory.tags) : '[]',
          embedding: memory.embedding ? JSON.stringify(memory.embedding) : null,
          metadata: memory.metadata ? JSON.stringify(memory.metadata) : null,
        });
        return { success: true };
      } catch (e: any) {
        logger.error(LogCategory.FILE, `db:addMemory Error: ${e.message}`, e);
        throw e;
      }
    });

    ipcMain.handle('db:deleteMemory', (_event, id: string) => {
      try {
        const stmt = db.prepare('DELETE FROM memories WHERE id = ?');
        stmt.run(id);
        return { success: true };
      } catch (e: any) {
        logger.error(LogCategory.FILE, `db:deleteMemory Error: ${e.message}`, e);
        throw e;
      }
    });

    ipcMain.handle('db:clearMemories', (_event, roleId: string) => {
      try {
        const stmt = db.prepare('DELETE FROM memories WHERE roleId = ?');
        stmt.run(roleId);
        return { success: true };
      } catch (e: any) {
        logger.error(LogCategory.FILE, `db:clearMemories Error: ${e.message}`, e);
        throw e;
      }
    });

    return db;
  } catch (err) {
    logger.error(LogCategory.APP, 'Failed to initialize database', err);
    throw err;
  }
}

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { AppConfig } from '../config.js';
import type { Logger } from '../core/logger.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface StorageHandle {
  db: Database;
  pool: pg.Pool;
  close: () => Promise<void>;
}

export function createStorage(
  config: Pick<AppConfig, 'DATABASE_URL'>,
  logger: Logger,
): StorageHandle {
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

  pool.on('error', (error) => {
    logger.error({ err: error }, 'postgres pool error');
  });

  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

export async function pingDatabase(pool: pg.Pool): Promise<boolean> {
  const result = await pool.query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

export { schema };

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { databaseOptionsFromEnv } from '../storage.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const options = databaseOptionsFromEnv();
const external = Boolean(options.databaseUrl || options.databaseConfig);
const ssl = process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== '0' } : undefined;
const database = external
  ? new pg.Pool({ ...(options.databaseUrl ? { connectionString: options.databaseUrl } : options.databaseConfig), ssl })
  : new PGlite(path.join(dataDir, 'postgres'));
if (!external) await database.waitReady;
const tables = ['products', 'inventory', 'customers', 'orders', 'order_items', 'staff', 'store_settings'];
for (const table of tables) {
  const result = await database.query(`SELECT count(*)::integer AS count FROM ${table}`);
  console.log(`${table}: ${result.rows[0].count}`);
}
const migration = await database.query('SELECT max(version)::integer AS version FROM schema_migrations');
console.log(`schema version: ${migration.rows[0].version}`);
if (external) await database.end();
else await database.close();

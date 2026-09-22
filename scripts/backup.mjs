import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

if (process.env.DATABASE_URL || process.env.PGHOST) {
  console.error('External PostgreSQL detected. Use pg_dump with your provider credentials.');
  process.exit(1);
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const databaseDir = path.join(dataDir, 'postgres');
if (!fs.existsSync(databaseDir)) throw new Error(`Database not found: ${databaseDir}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(dataDir, 'backups', stamp);
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });

const database = new PGlite(databaseDir);
await database.waitReady;
const dump = await database.dumpDataDir('gzip');
await database.close();
fs.writeFileSync(path.join(backupDir, 'database.tgz'), Buffer.from(await dump.arrayBuffer()), { mode: 0o600 });

const uploadsDir = path.join(dataDir, 'uploads');
if (fs.existsSync(uploadsDir)) fs.cpSync(uploadsDir, path.join(backupDir, 'uploads'), { recursive: true });
console.log(`Backup created: ${backupDir}`);

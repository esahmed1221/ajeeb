import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createStorage, databaseOptionsFromEnv } from '../storage.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sourceDataDir = path.resolve(process.env.SOURCE_DATA_DIR || path.join(root, 'data'));
const databaseOptions = databaseOptionsFromEnv();
if (!databaseOptions.databaseUrl && !databaseOptions.databaseConfig) {
  throw new Error('Set DATABASE_URL or PGHOST/PGDATABASE/PGUSER/PGPASSWORD for the target PostgreSQL database.');
}

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajeeb-pglite-import-'));
let sourceStorage;
let targetStorage;
let pool;
const customerPhoneKey = phone => String(phone ?? '').replace(/\D/g, '');

function copyIfPresent(source, destination) {
  if (!fs.existsSync(source)) return false;
  fs.cpSync(source, destination, { recursive: true });
  return true;
}

async function snapshotSource() {
  const copiedDatabase = copyIfPresent(path.join(sourceDataDir, 'postgres'), path.join(tempDir, 'postgres'));
  const copiedLegacyJson = copyIfPresent(path.join(sourceDataDir, 'store.json'), path.join(tempDir, 'store.json'));
  if (!copiedDatabase && !copiedLegacyJson) console.log(`No local database found in ${sourceDataDir}; initializing an empty PostgreSQL database.`);

  sourceStorage = await createStorage({ dataDir: tempDir });
  const [products, orders, customers, staff, settings] = await Promise.all([
    sourceStorage.listProducts(),
    sourceStorage.listOrders(),
    sourceStorage.listCustomers(),
    sourceStorage.listStaff(),
    sourceStorage.getSettings()
  ]);
  await sourceStorage.close();
  sourceStorage = undefined;
  return { products, orders, customers, staff, settings };
}

async function insertSnapshot(client, snapshot) {
  for (const product of snapshot.products) {
    await client.query(
      `INSERT INTO products (id,code,name,price,old_price,active,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [product.id, product.code, product.name, product.price, product.oldPrice, product.active, product.updatedAt]
    );
    for (const [position, image] of product.images.entries()) {
      await client.query('INSERT INTO product_images (product_id,position,path) VALUES ($1,$2,$3)', [product.id, position, image]);
    }
    for (const [size, stock] of Object.entries(product.sizes)) {
      await client.query('INSERT INTO inventory (product_id,size,stock) VALUES ($1,$2,$3)', [product.id, Number(size), stock]);
    }
  }

  for (const person of snapshot.staff) {
    await client.query(
      `INSERT INTO staff (id,name,username,active,permissions,password_salt,password_hash,session_version,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
      [person.id, person.name, person.username, person.active, JSON.stringify(person.permissions), person.salt, person.hash, person.sessionVersion, person.createdAt, person.updatedAt]
    );
  }

  await client.query(
    `INSERT INTO store_settings (id,phone,exchange_policy,privacy_policy,delivery,hero_image,hero_mobile_image,hero_title,hero_subtitle,telegram_chat_id,updated_at)
     VALUES (1,$1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,now())
     ON CONFLICT (id) DO UPDATE SET phone=EXCLUDED.phone,exchange_policy=EXCLUDED.exchange_policy,privacy_policy=EXCLUDED.privacy_policy,delivery=EXCLUDED.delivery,hero_image=EXCLUDED.hero_image,hero_mobile_image=EXCLUDED.hero_mobile_image,hero_title=EXCLUDED.hero_title,hero_subtitle=EXCLUDED.hero_subtitle,telegram_chat_id=EXCLUDED.telegram_chat_id,updated_at=now()`,
    [snapshot.settings.phone, snapshot.settings.exchangePolicy, snapshot.settings.privacyPolicy, JSON.stringify(snapshot.settings.delivery), snapshot.settings.heroImage, snapshot.settings.heroMobileImage, snapshot.settings.heroTitle, snapshot.settings.heroSubtitle, snapshot.settings.telegramChatId || '']
  );

  for (const customer of snapshot.customers) {
    await client.query(
      `INSERT INTO customers (id,name,phone,phone_key,city,address,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [customer.id, customer.name, customer.phone, customerPhoneKey(customer.phone) || `legacy-${customer.id}`, customer.city, customer.address, customer.createdAt, customer.updatedAt]
    );
  }

  for (const order of [...snapshot.orders].reverse()) {
    await client.query(
      `INSERT INTO orders (id,number,customer_id,customer_name,customer_phone,customer_city,customer_address,customer_notes,subtotal,delivery,total,status,stock_restored,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [order.id, order.number, order.customerId, order.customer.name, order.customer.phone, order.customer.city, order.customer.address, order.customer.notes, order.subtotal, order.delivery, order.total, order.status, order.stockRestored, order.createdAt]
    );
    for (const item of order.items) {
      await client.query(
        'INSERT INTO order_items (order_id,product_id,product_code,product_name,size,quantity,unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [order.id, item.productId, item.code, item.name, Number(item.size), item.qty, item.price]
      );
    }
  }
}

try {
  const snapshot = await snapshotSource();
  const targetDataDir = path.join(tempDir, 'target');
  targetStorage = await createStorage({ dataDir: targetDataDir, ...databaseOptions });
  await targetStorage.close();
  targetStorage = undefined;

  const ssl = process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== '0' } : undefined;
  pool = new pg.Pool({ ...(databaseOptions.databaseUrl ? { connectionString: databaseOptions.databaseUrl } : databaseOptions.databaseConfig), ssl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS docker_data_imports (
      source_key text PRIMARY KEY,
      imported_at timestamptz NOT NULL DEFAULT now(),
      summary jsonb NOT NULL
    )`);
    const previous = await client.query("SELECT summary FROM docker_data_imports WHERE source_key='pglite-v1'");
    if (previous.rowCount) {
      console.log(`PGlite import already completed: ${JSON.stringify(previous.rows[0].summary)}`);
    } else {
      const counts = await client.query(`SELECT
        (SELECT count(*)::integer FROM products) AS products,
        (SELECT count(*)::integer FROM customers) AS customers,
        (SELECT count(*)::integer FROM orders) AS orders,
        (SELECT count(*)::integer FROM staff) AS staff,
        EXISTS (
          SELECT 1 FROM store_settings WHERE id=1 AND (
            phone<>'' OR exchange_policy<>'' OR privacy_policy<>'' OR delivery<>'{}'::jsonb OR
            hero_image<>'' OR hero_mobile_image<>'' OR hero_title<>'' OR hero_subtitle<>'' OR telegram_chat_id<>''
          )
        ) AS customized_settings`);
      const occupied = Object.values(counts.rows[0]).some(value => Number(value) > 0);
      if (occupied) throw new Error(`Target PostgreSQL already contains application data (${JSON.stringify(counts.rows[0])}); refusing to overwrite it.`);

      const summary = { products: snapshot.products.length, customers: snapshot.customers.length, orders: snapshot.orders.length, staff: snapshot.staff.length };
      await client.query('BEGIN');
      try {
        await insertSnapshot(client, snapshot);
        await client.query("INSERT INTO docker_data_imports (source_key,summary) VALUES ('pglite-v1',$1::jsonb)", [JSON.stringify(summary)]);
        await client.query('COMMIT');
        console.log(`PGlite import completed: ${JSON.stringify(summary)}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
  }
} finally {
  if (sourceStorage) await sourceStorage.close();
  if (targetStorage) await targetStorage.close();
  if (pool) await pool.end();
  fs.rmSync(tempDir, { recursive: true, force: true });
}

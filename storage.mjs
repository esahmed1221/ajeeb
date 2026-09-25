import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const emptySettings = () => ({ phone: '', exchangePolicy: '', privacyPolicy: '', delivery: {}, heroImage: '', heroMobileImage: '', heroTitle: '', heroSubtitle: '', telegramChatId: '' });
const normalizeLegacy = value => ({
  products: Array.isArray(value?.products) ? value.products : [],
  orders: Array.isArray(value?.orders) ? value.orders : [],
  staff: Array.isArray(value?.staff) ? value.staff : [],
  settings: { ...emptySettings(), ...(value?.settings || {}), delivery: value?.settings?.delivery || {} }
});
function readJson(dataFile) { return fs.existsSync(dataFile) ? normalizeLegacy(JSON.parse(fs.readFileSync(dataFile, 'utf8'))) : normalizeLegacy(); }
function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
const customerPhoneKey = phone => String(phone ?? '').replace(/\D/g, '');

export function databaseOptionsFromEnv(env = process.env) {
  if (env.DATABASE_URL) return { databaseUrl: env.DATABASE_URL };
  if (!env.PGHOST) return {};
  return {
    databaseConfig: {
      host: env.PGHOST,
      port: Number(env.PGPORT || 5432),
      database: env.PGDATABASE,
      user: env.PGUSER,
      password: env.PGPASSWORD
    }
  };
}

async function createDriver(databaseUrl, databaseConfig, databaseDir) {
  if (databaseUrl || databaseConfig) {
    const { Pool } = await import('pg');
    const ssl = process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== '0' } : undefined;
    const pool = new Pool({ ...(databaseUrl ? { connectionString: databaseUrl } : databaseConfig), ssl, max: Number(process.env.DATABASE_POOL_SIZE || 10), connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
    await pool.query('SELECT 1');
    return {
      kind: 'PostgreSQL', query: (sql, params = []) => pool.query(sql, params), exec: sql => pool.query(sql),
      transaction: async callback => {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const result = await callback(client); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
      close: () => pool.end()
    };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const database = new PGlite(databaseDir); await database.waitReady;
  return { kind: 'PGlite (normalized local PostgreSQL)', query: (sql, params = []) => database.query(sql, params), exec: sql => database.exec(sql), transaction: callback => database.transaction(callback), close: () => database.close() };
}

async function createSchema(driver) {
  await driver.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS products (id uuid PRIMARY KEY, code varchar(40) NOT NULL UNIQUE, name varchar(120) NOT NULL, price integer NOT NULL CHECK (price > 0), old_price integer NOT NULL DEFAULT 0 CHECK (old_price >= 0), active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS product_images (product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, position smallint NOT NULL CHECK (position BETWEEN 0 AND 5), path text NOT NULL, PRIMARY KEY (product_id, position));
    CREATE TABLE IF NOT EXISTS inventory (product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE, size smallint NOT NULL CHECK (size BETWEEN 20 AND 50), stock integer NOT NULL CHECK (stock >= 0), PRIMARY KEY (product_id, size));
    CREATE TABLE IF NOT EXISTS staff (id uuid PRIMARY KEY, name varchar(80) NOT NULL, username varchar(32) NOT NULL UNIQUE, active boolean NOT NULL DEFAULT true, permissions jsonb NOT NULL DEFAULT '[]'::jsonb, password_salt text NOT NULL, password_hash text NOT NULL, session_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS store_settings (id smallint PRIMARY KEY CHECK (id = 1), phone varchar(50) NOT NULL DEFAULT '', exchange_policy text NOT NULL DEFAULT '', privacy_policy text NOT NULL DEFAULT '', delivery jsonb NOT NULL DEFAULT '{}'::jsonb, hero_image text NOT NULL DEFAULT '', hero_mobile_image text NOT NULL DEFAULT '', hero_title varchar(100) NOT NULL DEFAULT '', hero_subtitle varchar(240) NOT NULL DEFAULT '', telegram_chat_id text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS telegram_chat_id text NOT NULL DEFAULT '';
    CREATE TABLE IF NOT EXISTS customers (id uuid PRIMARY KEY, name varchar(100) NOT NULL, phone varchar(25) NOT NULL, phone_key varchar(64) NOT NULL UNIQUE, city varchar(80) NOT NULL, address varchar(300) NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
    CREATE TABLE IF NOT EXISTS orders (id uuid PRIMARY KEY, number varchar(60) NOT NULL UNIQUE, customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT, customer_name varchar(100) NOT NULL, customer_phone varchar(25) NOT NULL, customer_city varchar(80) NOT NULL, customer_address varchar(300) NOT NULL, customer_notes varchar(500) NOT NULL DEFAULT '', subtotal integer NOT NULL CHECK (subtotal >= 0), delivery integer NOT NULL CHECK (delivery >= 0), total integer NOT NULL CHECK (total >= 0), status varchar(30) NOT NULL, stock_restored boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES customers(id) ON DELETE RESTRICT;
    CREATE TABLE IF NOT EXISTS order_counter (id smallint PRIMARY KEY CHECK (id = 1), last_number bigint NOT NULL DEFAULT 0 CHECK (last_number >= 0));
    INSERT INTO order_counter (id,last_number) SELECT 1,count(*) FROM orders ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS order_items (order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id uuid NOT NULL, product_code varchar(40) NOT NULL, product_name varchar(120) NOT NULL, size smallint NOT NULL, quantity integer NOT NULL CHECK (quantity > 0), unit_price integer NOT NULL CHECK (unit_price >= 0), PRIMARY KEY (order_id, product_id, size));
    CREATE INDEX IF NOT EXISTS customers_updated_at_idx ON customers (updated_at DESC);
    CREATE INDEX IF NOT EXISTS customers_name_idx ON customers (name);
    CREATE INDEX IF NOT EXISTS orders_customer_id_idx ON orders (customer_id);
    CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders (created_at DESC);
    CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);
    CREATE INDEX IF NOT EXISTS products_active_idx ON products (active);
    CREATE INDEX IF NOT EXISTS inventory_available_size_idx ON inventory (size) WHERE stock > 0;
  `);
}

async function legacyState(driver, dataFile) {
  try { const result = await driver.query('SELECT data FROM app_state WHERE id = 1'); if (result.rows[0]?.data) return normalizeLegacy(result.rows[0].data); }
  catch (error) { if (error.code !== '42P01') throw error; }
  return readJson(dataFile);
}

async function insertProduct(tx, product) {
  await tx.query(`INSERT INTO products (id,code,name,price,old_price,active,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,price=EXCLUDED.price,old_price=EXCLUDED.old_price,active=EXCLUDED.active,updated_at=EXCLUDED.updated_at`, [product.id, product.code, product.name, product.price, product.oldPrice || 0, product.active, product.updatedAt]);
  await tx.query('DELETE FROM product_images WHERE product_id=$1', [product.id]);
  await tx.query('DELETE FROM inventory WHERE product_id=$1', [product.id]);
  for (const [position, image] of (product.images || []).entries()) await tx.query('INSERT INTO product_images (product_id,position,path) VALUES ($1,$2,$3)', [product.id, position, image]);
  for (const [size, stock] of Object.entries(product.sizes || {})) await tx.query('INSERT INTO inventory (product_id,size,stock) VALUES ($1,$2,$3)', [product.id, Number(size), stock]);
}
async function insertStaff(tx, person) {
  await tx.query(`INSERT INTO staff (id,name,username,active,permissions,password_salt,password_hash,session_version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,username=EXCLUDED.username,active=EXCLUDED.active,permissions=EXCLUDED.permissions,password_salt=EXCLUDED.password_salt,password_hash=EXCLUDED.password_hash,session_version=EXCLUDED.session_version,updated_at=EXCLUDED.updated_at`, [person.id, person.name, person.username, person.active, JSON.stringify(person.permissions), person.salt, person.hash, person.sessionVersion, person.createdAt, person.updatedAt]);
}
async function upsertSettings(tx, settings) {
  await tx.query(`INSERT INTO store_settings (id,phone,exchange_policy,privacy_policy,delivery,hero_image,hero_mobile_image,hero_title,hero_subtitle,telegram_chat_id,updated_at) VALUES (1,$1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,now()) ON CONFLICT (id) DO UPDATE SET phone=EXCLUDED.phone,exchange_policy=EXCLUDED.exchange_policy,privacy_policy=EXCLUDED.privacy_policy,delivery=EXCLUDED.delivery,hero_image=EXCLUDED.hero_image,hero_mobile_image=EXCLUDED.hero_mobile_image,hero_title=EXCLUDED.hero_title,hero_subtitle=EXCLUDED.hero_subtitle,telegram_chat_id=EXCLUDED.telegram_chat_id,updated_at=now()`, [settings.phone, settings.exchangePolicy, settings.privacyPolicy, JSON.stringify(settings.delivery), settings.heroImage, settings.heroMobileImage, settings.heroTitle, settings.heroSubtitle, settings.telegramChatId || '']);
}

async function migrateLegacy(driver, dataFile) {
  const already = await driver.query('SELECT 1 FROM schema_migrations WHERE version=1'); if (already.rowCount) return;
  const legacy = await legacyState(driver, dataFile);
  await driver.transaction(async tx => {
    for (const product of legacy.products) await insertProduct(tx, product);
    for (const person of legacy.staff) await insertStaff(tx, person);
    await upsertSettings(tx, legacy.settings);
    for (const order of [...legacy.orders].reverse()) {
      await tx.query(`INSERT INTO orders (id,number,customer_name,customer_phone,customer_city,customer_address,customer_notes,subtotal,delivery,total,status,stock_restored,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING`, [order.id, order.number, order.customer.name, order.customer.phone, order.customer.city, order.customer.address, order.customer.notes || '', order.subtotal, order.delivery, order.total, order.status, Boolean(order.stockRestored), order.createdAt]);
      for (const item of order.items || []) await tx.query('INSERT INTO order_items (order_id,product_id,product_code,product_name,size,quantity,unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING', [order.id, item.productId, item.code, item.name, Number(item.size), item.qty, item.price]);
    }
    await tx.query('INSERT INTO schema_migrations (version) VALUES (1)');
  });
}

async function migrateCustomers(driver) {
  const already = await driver.query('SELECT 1 FROM schema_migrations WHERE version=2');
  if (already.rowCount) return;
  await driver.transaction(async tx => {
    const orders = await tx.query(`SELECT id,customer_name,customer_phone,customer_city,customer_address,created_at FROM orders WHERE customer_id IS NULL ORDER BY created_at,id`);
    for (const order of orders.rows) {
      const phoneKey = customerPhoneKey(order.customer_phone) || `legacy-${order.id}`;
      const customer = await tx.query(
        `INSERT INTO customers (id,name,phone,phone_key,city,address,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT (phone_key) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,city=EXCLUDED.city,address=EXCLUDED.address,updated_at=EXCLUDED.updated_at
         RETURNING id`,
        [crypto.randomUUID(), order.customer_name, order.customer_phone, phoneKey, order.customer_city, order.customer_address, order.created_at]
      );
      await tx.query('UPDATE orders SET customer_id=$2 WHERE id=$1', [order.id, customer.rows[0].id]);
    }
    await tx.query('ALTER TABLE orders ALTER COLUMN customer_id SET NOT NULL');
    await tx.query('INSERT INTO schema_migrations (version) VALUES (2)');
  });
}

async function migrateTelegramSettings(driver) {
  const already = await driver.query('SELECT 1 FROM schema_migrations WHERE version=3');
  if (already.rowCount) return;
  await driver.transaction(async tx => {
    await tx.query("ALTER TABLE store_settings ADD COLUMN IF NOT EXISTS telegram_chat_id text NOT NULL DEFAULT ''");
    await tx.query('INSERT INTO schema_migrations (version) VALUES (3)');
  });
}

async function migrateSequentialOrderNumbers(driver) {
  const already = await driver.query('SELECT 1 FROM schema_migrations WHERE version=4');
  if (already.rowCount) return;
  await driver.transaction(async tx => {
    await tx.query("UPDATE orders SET number='v4-' || id::text");
    await tx.query(`WITH numbered AS (
      SELECT id,row_number() OVER (ORDER BY created_at,id) AS sequence_number FROM orders
    )
    UPDATE orders SET number=numbered.sequence_number::text FROM numbered WHERE orders.id=numbered.id`);
    await tx.query('UPDATE order_counter SET last_number=(SELECT count(*) FROM orders) WHERE id=1');
    await tx.query('INSERT INTO schema_migrations (version) VALUES (4)');
  });
}

const productSelect = `
  SELECT p.*,
    COALESCE((SELECT jsonb_agg(pi.path ORDER BY pi.position) FROM product_images pi WHERE pi.product_id=p.id), '[]'::jsonb) AS images,
    COALESCE((SELECT jsonb_object_agg(i.size::text, i.stock ORDER BY i.size) FROM inventory i WHERE i.product_id=p.id), '{}'::jsonb) AS sizes
  FROM products p`;
const orderSelect = `
  SELECT o.*,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',oi.product_id,'code',oi.product_code,'name',oi.product_name,'size',oi.size::text,'qty',oi.quantity,'price',oi.unit_price) ORDER BY oi.product_id,oi.size) FROM order_items oi WHERE oi.order_id=o.id), '[]'::jsonb) AS items
  FROM orders o`;

function mapProduct(row) {
  const sizes = jsonValue(row.sizes, {});
  return { id: row.id, code: row.code, name: row.name, price: Number(row.price), oldPrice: Number(row.old_price), active: row.active, updatedAt: new Date(row.updated_at).toISOString(), images: jsonValue(row.images, []), sizes: Object.fromEntries(Object.entries(sizes).map(([size, stock]) => [size, Number(stock)])) };
}
function mapStaff(row) {
  return { id: row.id, name: row.name, username: row.username, active: row.active, permissions: jsonValue(row.permissions, []), salt: row.password_salt, hash: row.password_hash, sessionVersion: Number(row.session_version), createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}
function mapSettings(row) {
  return row ? { phone: row.phone, exchangePolicy: row.exchange_policy, privacyPolicy: row.privacy_policy, delivery: jsonValue(row.delivery, {}), heroImage: row.hero_image, heroMobileImage: row.hero_mobile_image, heroTitle: row.hero_title, heroSubtitle: row.hero_subtitle, telegramChatId: row.telegram_chat_id || '' } : emptySettings();
}
function mapOrder(row) {
  const items = jsonValue(row.items, []).map(item => ({ productId: item.productId, code: item.code, name: item.name, size: String(item.size), qty: Number(item.qty), price: Number(item.price) }));
  return { id: row.id, number: row.number, customerId: row.customer_id, customer: { name: row.customer_name, phone: row.customer_phone, city: row.customer_city, address: row.customer_address, notes: row.customer_notes }, items, subtotal: Number(row.subtotal), delivery: Number(row.delivery), total: Number(row.total), status: row.status, stockRestored: row.stock_restored, createdAt: new Date(row.created_at).toISOString() };
}
function mapCustomer(row) {
  return { id: row.id, name: row.name, phone: row.phone, city: row.city, address: row.address, orderCount: Number(row.order_count || 0), totalSpent: Number(row.total_spent || 0), lastOrderAt: row.last_order_at ? new Date(row.last_order_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() };
}

async function listProducts(driver, activeOnly = false) {
  const result = await driver.query(`${productSelect}${activeOnly ? ' WHERE p.active=true' : ''} ORDER BY p.updated_at DESC`);
  return result.rows.map(mapProduct);
}
function catalogConditions(query, size) {
  const conditions = ['p.active=true'], params = [];
  if (query) {
    params.push(`%${query}%`); const position = params.length;
    conditions.push(`(p.name ILIKE $${position} OR p.code ILIKE $${position})`);
  }
  if (size) {
    params.push(Number(size)); const position = params.length;
    conditions.push(`EXISTS (SELECT 1 FROM inventory available_inventory WHERE available_inventory.product_id=p.id AND available_inventory.size=$${position} AND available_inventory.stock>0)`);
  }
  return { where: conditions.join(' AND '), params };
}
async function listCatalogPage(driver, { page = 1, pageSize = 15, query = '', size = '' } = {}) {
  const filter = catalogConditions(query, size);
  const countResult = await driver.query(`SELECT count(*)::integer AS total FROM products p WHERE ${filter.where}`, filter.params);
  const totalItems = Number(countResult.rows[0]?.total || 0);
  const totalPages = Math.ceil(totalItems / pageSize);
  const currentPage = totalPages ? Math.min(Math.max(page, 1), totalPages) : 1;
  const params = [...filter.params, pageSize, (currentPage - 1) * pageSize];
  const result = await driver.query(`${productSelect} WHERE ${filter.where} ORDER BY p.updated_at DESC,p.id LIMIT $${filter.params.length + 1} OFFSET $${filter.params.length + 2}`, params);
  return { products: result.rows.map(mapProduct), page: currentPage, pageSize, totalItems, totalPages };
}
async function listAvailableSizes(driver) {
  const result = await driver.query('SELECT DISTINCT i.size FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.active=true AND i.stock>0 ORDER BY i.size');
  return result.rows.map(row => String(row.size));
}
async function listProductsByIds(driver, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
  const result = await driver.query(`${productSelect} WHERE p.active=true AND p.id IN (${placeholders}) ORDER BY p.updated_at DESC,p.id`, ids);
  return result.rows.map(mapProduct);
}
async function findProduct(driver, id) {
  const result = await driver.query(`${productSelect} WHERE p.id=$1`, [id]);
  return result.rows[0] ? mapProduct(result.rows[0]) : null;
}
async function deleteProduct(driver, id) {
  return driver.transaction(async tx => {
    const result = await tx.query(`${productSelect} WHERE p.id=$1 FOR UPDATE`, [id]);
    if (!result.rows[0]) return null;
    const product = mapProduct(result.rows[0]);
    await tx.query('DELETE FROM products WHERE id=$1', [id]);
    return product;
  });
}
async function imagePathInUse(driver, imagePath) {
  const result = await driver.query(`SELECT 1 FROM product_images WHERE path=$1 UNION ALL SELECT 1 FROM store_settings WHERE hero_image=$1 OR hero_mobile_image=$1 LIMIT 1`, [imagePath]);
  return Boolean(result.rowCount);
}
async function listOrders(driver) {
  const result = await driver.query(`${orderSelect} ORDER BY o.created_at DESC`);
  return result.rows.map(mapOrder);
}
async function findOrder(driver, id) {
  const result = await driver.query(`${orderSelect} WHERE o.id=$1`, [id]);
  return result.rows[0] ? mapOrder(result.rows[0]) : null;
}
async function listCustomers(driver) {
  const result = await driver.query(`
    SELECT c.*,count(o.id)::integer AS order_count,COALESCE(sum(CASE WHEN o.status NOT IN ('ملغي','راجع') THEN o.total ELSE 0 END),0) AS total_spent,max(o.created_at) AS last_order_at
    FROM customers c LEFT JOIN orders o ON o.customer_id=c.id
    GROUP BY c.id ORDER BY c.updated_at DESC`);
  return result.rows.map(mapCustomer);
}
async function listStaff(driver) {
  const result = await driver.query('SELECT * FROM staff ORDER BY created_at');
  return result.rows.map(mapStaff);
}
async function findStaffById(driver, id) {
  const result = await driver.query('SELECT * FROM staff WHERE id=$1', [id]);
  return result.rows[0] ? mapStaff(result.rows[0]) : null;
}
async function findStaffByUsername(driver, username) {
  const result = await driver.query('SELECT * FROM staff WHERE username=$1', [username]);
  return result.rows[0] ? mapStaff(result.rows[0]) : null;
}
async function getSettings(driver) {
  const result = await driver.query('SELECT * FROM store_settings WHERE id=1');
  return mapSettings(result.rows[0]);
}

export async function createStorage({ dataDir, databaseUrl, databaseConfig }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const driver = await createDriver(databaseUrl, databaseConfig, path.join(dataDir, 'postgres'));
  await createSchema(driver); await migrateLegacy(driver, path.join(dataDir, 'store.json')); await migrateCustomers(driver); await migrateTelegramSettings(driver); await migrateSequentialOrderNumbers(driver);
  return {
    kind: driver.kind,
    listProducts: ({ activeOnly = false } = {}) => listProducts(driver, activeOnly),
    listCatalogPage: options => listCatalogPage(driver, options),
    listAvailableSizes: () => listAvailableSizes(driver),
    listProductsByIds: ids => listProductsByIds(driver, ids),
    findProduct: id => findProduct(driver, id),
    deleteProduct: id => deleteProduct(driver, id),
    imagePathInUse: imagePath => imagePathInUse(driver, imagePath),
    productCodeExists: async (code, excludedId = null) => {
      const result = await driver.query('SELECT 1 FROM products WHERE code=$1 AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1', [code, excludedId]);
      return Boolean(result.rowCount);
    },
    saveProduct: product => driver.transaction(tx => insertProduct(tx, product)),
    listOrders: () => listOrders(driver),
    findOrder: id => findOrder(driver, id),
    listCustomers: () => listCustomers(driver),
    listStaff: () => listStaff(driver),
    findStaffById: id => findStaffById(driver, id),
    findStaffByUsername: username => findStaffByUsername(driver, username),
    staffUsernameExists: async (username, excludedId = null) => {
      const result = await driver.query('SELECT 1 FROM staff WHERE username=$1 AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1', [username, excludedId]);
      return Boolean(result.rowCount);
    },
    saveStaff: person => driver.transaction(tx => insertStaff(tx, person)),
    getSettings: () => getSettings(driver),
    saveSettings: settings => driver.transaction(tx => upsertSettings(tx, settings)),
    async createOrder(draft) {
      return driver.transaction(async tx => {
        const settingsResult = await tx.query('SELECT delivery FROM store_settings WHERE id=1');
        const deliveryTable = jsonValue(settingsResult.rows[0]?.delivery, {});
        const delivery = deliveryTable[draft.customer.city];
        if (delivery === undefined) { const error = new Error('INVALID_CITY'); error.code = 'INVALID_CITY'; throw error; }
        const items = []; let subtotal = 0;
        for (const line of draft.lines) {
          const result = await tx.query(`SELECT p.id,p.code,p.name,p.price,p.active,i.stock FROM products p JOIN inventory i ON i.product_id=p.id WHERE p.id=$1 AND i.size=$2 FOR UPDATE`, [line.productId, Number(line.size)]);
          const product = result.rows[0];
          if (!product || !product.active || Number(product.stock) < line.qty) { const error = new Error('STOCK_CONFLICT'); error.code = 'STOCK_CONFLICT'; throw error; }
          const updated = await tx.query('UPDATE inventory SET stock=stock-$3 WHERE product_id=$1 AND size=$2 AND stock >= $3 RETURNING stock', [line.productId, Number(line.size), line.qty]);
          if (!updated.rowCount) { const error = new Error('STOCK_CONFLICT'); error.code = 'STOCK_CONFLICT'; throw error; }
          const price = Number(product.price);
          items.push({ productId: product.id, code: product.code, name: product.name, size: String(line.size), qty: line.qty, price });
          subtotal += price * line.qty;
        }
        const phoneKey = customerPhoneKey(draft.customer.phone);
        const customerResult = await tx.query(
          `INSERT INTO customers (id,name,phone,phone_key,city,address,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
           ON CONFLICT (phone_key) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,city=EXCLUDED.city,address=EXCLUDED.address,updated_at=EXCLUDED.updated_at
           RETURNING id`,
          [crypto.randomUUID(), draft.customer.name, draft.customer.phone, phoneKey, draft.customer.city, draft.customer.address, draft.createdAt]
        );
        const customerId = customerResult.rows[0].id;
        const numberResult = await tx.query('UPDATE order_counter SET last_number=last_number+1 WHERE id=1 RETURNING last_number::text AS number');
        const order = { id: draft.id, number: numberResult.rows[0].number, customerId, customer: draft.customer, items, subtotal, delivery: Number(delivery), total: subtotal + Number(delivery), status: 'جديد', stockRestored: false, createdAt: draft.createdAt };
        await tx.query(`INSERT INTO orders (id,number,customer_id,customer_name,customer_phone,customer_city,customer_address,customer_notes,subtotal,delivery,total,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [order.id, order.number, order.customerId, order.customer.name, order.customer.phone, order.customer.city, order.customer.address, order.customer.notes, order.subtotal, order.delivery, order.total, order.status, order.createdAt]);
        for (const item of order.items) await tx.query('INSERT INTO order_items (order_id,product_id,product_code,product_name,size,quantity,unit_price) VALUES ($1,$2,$3,$4,$5,$6,$7)', [order.id, item.productId, item.code, item.name, Number(item.size), item.qty, item.price]);
        return order;
      });
    },
    async updateOrderStatus(id, status, restoreRequested) {
      return driver.transaction(async tx => {
        const currentResult = await tx.query('SELECT stock_restored FROM orders WHERE id=$1 FOR UPDATE', [id]);
        if (!currentResult.rowCount) return null;
        const currentRestored = currentResult.rows[0].stock_restored;
        if (currentRestored && !['ملغي', 'راجع'].includes(status)) { const error = new Error('STOCK_ALREADY_RESTORED'); error.code = 'STOCK_ALREADY_RESTORED'; throw error; }
        const restoreStock = Boolean(restoreRequested && !currentRestored && ['ملغي', 'راجع'].includes(status));
        if (restoreStock) {
          await tx.query(`INSERT INTO inventory (product_id,size,stock) SELECT oi.product_id,oi.size,oi.quantity FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=$1 ON CONFLICT (product_id,size) DO UPDATE SET stock=inventory.stock+EXCLUDED.stock`, [id]);
        }
        await tx.query('UPDATE orders SET status=$2,stock_restored=$3 WHERE id=$1', [id, status, currentRestored || restoreStock]);
        const updated = await tx.query(`${orderSelect} WHERE o.id=$1`, [id]);
        return mapOrder(updated.rows[0]);
      });
    },
    close: () => driver.close()
  };
}

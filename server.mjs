import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStorage, databaseOptionsFromEnv } from './storage.mjs';
import { sendTelegramOrder, validTelegramChatId } from './telegram.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const publicDir = path.join(root, 'public');
const uploadDir = path.join(dataDir, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = await createStorage({ dataDir, ...databaseOptionsFromEnv() });

const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.ADMIN_PASSWORD_B64 ? Buffer.from(process.env.ADMIN_PASSWORD_B64, 'base64').toString('utf8') : (process.env.ADMIN_PASSWORD || '');
const sessionSecret = process.env.SESSION_SECRET || '';
const siteOrigin = process.env.SITE_ORIGIN || '';
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
const adminConfigured = adminPassword.length >= 16 && sessionSecret.length >= 48 && !adminPassword.startsWith('replace-with') && !sessionSecret.startsWith('replace-with');
const attempts = new Map();
const activeVisitors = new Map();
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const noCache = { 'Cache-Control': 'no-store' };
const permissions = ['orders.view', 'orders.manage', 'products.view', 'products.manage', 'settings.view', 'settings.manage'];
const owner = { id: 'owner', name: 'المالك', username: 'owner', owner: true, permissions, sessionVersion: crypto.createHash('sha256').update(adminPassword).digest('hex').slice(0, 16) };

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...noCache, ...headers });
  res.end(payload);
}
function fail(res, status, message) { send(res, status, { error: message }); }
function id() { return crypto.randomUUID(); }
function clean(s, max = 200) { return String(s ?? '').trim().slice(0, max); }
function positiveInt(v, max = 100000) { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 && n <= max ? n : null; }
async function auth(req) {
  const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('ajeeb_session='));
  const token = cookie?.slice('ajeeb_session='.length);
  if (!token || !adminConfigured) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const expected = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Number(value.exp) < Date.now()) return null;
    if (value.id === 'owner') return value.version === owner.sessionVersion ? owner : null;
    const staff = await storage.findStaffById(value.id);
    if (!staff?.active || staff.sessionVersion !== value.version) return null;
    return staff ? { id: staff.id, name: staff.name, username: staff.username, owner: false, permissions: staff.permissions } : null;
  } catch { return null; }
}
function session(person) {
  const payload = Buffer.from(JSON.stringify({ id: person.id, version: person.sessionVersion || 0, exp: Date.now() + 12 * 3600000, nonce: crypto.randomBytes(12).toString('hex') })).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex')}`;
}
function can(person, permission) { return person?.owner || person?.permissions?.includes(permission) || (permission.endsWith('.view') && person?.permissions?.includes(permission.replace('.view', '.manage'))); }
function publicStaff(x) { return { id: x.id, name: x.name, username: x.username, active: x.active, permissions: x.permissions, createdAt: x.createdAt, updatedAt: x.updatedAt }; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') }; }
function validStaff(input, existing) {
  const name = clean(input.name, 80), username = clean(input.username, 32).toLowerCase();
  if (name.length < 2 || !/^[a-z][a-z0-9._-]{2,31}$/.test(username) || username === 'owner') throw new Error('اكتب اسمًا واسم مستخدم إنجليزي من 3 أحرف أو أكثر');
  if (!Array.isArray(input.permissions) || input.permissions.some(x => !permissions.includes(x))) throw new Error('الصلاحيات غير صالحة');
  const selected = [...new Set(input.permissions)];
  const password = String(input.password || '');
  if ((!existing || password) && password.length < 12) throw new Error('رمز الموظف لازم يكون 12 حرفًا أو أكثر');
  const now = new Date().toISOString();
  return { id: existing?.id || id(), name, username, active: input.active !== false, permissions: selected, ...(password ? hashPassword(password) : { salt: existing.salt, hash: existing.hash }), sessionVersion: (existing?.sessionVersion || 0) + 1, createdAt: existing?.createdAt || now, updatedAt: now };
}
function cookie(req, value, maxAge) {
  const secure = siteOrigin.startsWith('https://') ? '; Secure' : '';
  return `ajeeb_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
async function body(req, limit = 4_000_000) {
  let n = 0; const chunks = [];
  for await (const chunk of req) { n += chunk.length; if (n > limit) throw new Error('الملف أو البيانات كبيرة جدًا'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = `${req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'}://${req.headers.host}`;
  return origin === host || (siteOrigin && origin === siteOrigin);
}
function limitedKey(key, max, windowMs) {
  const now = Date.now();
  const recent = (attempts.get(key) || []).filter(time => now - time < windowMs);
  recent.push(now); attempts.set(key, recent); return recent.length > max;
}
function limited(req, key, max, windowMs) {
  const localProxy = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const ip = localProxy ? (req.headers['x-real-ip'] || req.socket.remoteAddress) : req.socket.remoteAddress;
  return limitedKey(`${key}:ip:${ip || 'unknown'}`, max, windowMs);
}
function limitedValue(key, value, max, windowMs) { return limitedKey(`${key}:${value}`, max, windowMs); }
function liveVisitorCount() {
  const cutoff = Date.now() - 60000;
  for (const [visitor, seen] of activeVisitors) if (seen < cutoff) activeVisitors.delete(visitor);
  return activeVisitors.size;
}
function productForPublic(p) {
  return { id: p.id, code: p.code, name: p.name, price: p.price, oldPrice: p.oldPrice, images: p.images, sizes: p.sizes, active: p.active };
}
function validImagePath(value) { return value === '' || value === '/featured-banner.jpg' || /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(value) || /^\/products\/[a-z0-9-]+\.(png|jpg|webp)$/.test(value); }
async function notifyNewOrder(order) {
  try {
    const settings = await storage.getSettings();
    const result = await sendTelegramOrder({ token: telegramBotToken, chatId: settings.telegramChatId, order });
    if (result.sent) console.log(`Telegram order notification sent for ${order.number}`);
  } catch (error) {
    console.error(`Telegram order notification failed for ${order.number}: ${error.message}`);
  }
}
function validProduct(input, existing) {
  const name = clean(input.name, 120), code = clean(input.code, 40);
  const price = positiveInt(input.price, 1000000), oldPrice = positiveInt(input.oldPrice || 0, 1000000);
  const sizes = {};
  for (const [size, qty] of Object.entries(input.sizes || {})) {
    if (!/^\d{2}$/.test(size) || Number(size) < 20 || Number(size) > 50) throw new Error('المقاسات غير صالحة');
    const q = positiveInt(qty, 100000); if (q === null) throw new Error('الكمية غير صالحة'); sizes[size] = q;
  }
  const images = Array.isArray(input.images) ? input.images.slice(0, 6).filter(x => /^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/.test(x) || /^\/products\/[a-z0-9-]+\.(png|jpg|webp)$/.test(x)) : [];
  if (!name || !code || price === null || price === 0 || oldPrice === null || Object.keys(sizes).length === 0) throw new Error('أكمل اسم المنتج والكود والسعر والمقاسات');
  return { id: existing?.id || id(), name, code, price, oldPrice, sizes, images, active: Boolean(input.active), updatedAt: new Date().toISOString() };
}
function detectImage(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'png';
  if (buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'jpg';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return fail(res, 404, 'غير موجود');
  const ext = path.extname(file).toLowerCase();
  if (!mime[ext]) return fail(res, 404, 'غير موجود');
  send(res, 200, fs.readFileSync(file), { 'Content-Type': mime[ext], 'Cache-Control': ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext) ? 'public, max-age=86400' : 'no-store', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'", 'X-Frame-Options': 'DENY' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === '/healthz' && req.method === 'GET') {
      await storage.getSettings();
      return send(res, 200, { ok: true });
    }
    if (req.method !== 'GET' && !allowedOrigin(req)) return fail(res, 403, 'طلب غير مسموح');
    if (pathname === '/api/catalog' && req.method === 'GET') {
      const page = positiveInt(url.searchParams.get('page') || 1, 100000), query = clean(url.searchParams.get('q'), 80), size = clean(url.searchParams.get('size'), 2);
      if (!page || (size && (!/^\d{2}$/.test(size) || Number(size) < 20 || Number(size) > 50))) return fail(res, 400, 'صفحة أو مقاس غير صالح');
      const [catalog, settings, availableSizes] = await Promise.all([storage.listCatalogPage({ page, pageSize: 15, query, size }), storage.getSettings(), storage.listAvailableSizes()]);
      return send(res, 200, { products: catalog.products.map(productForPublic), preview: process.env.DEMO_PREVIEW === '1' && catalog.totalItems === 0 && !query && !size, availableSizes, pagination: { page: catalog.page, pageSize: catalog.pageSize, totalItems: catalog.totalItems, totalPages: catalog.totalPages }, settings: { phone: settings.phone, exchangePolicy: settings.exchangePolicy, privacyPolicy: settings.privacyPolicy, delivery: settings.delivery, heroImage: settings.heroImage || '', heroMobileImage: settings.heroMobileImage || '', heroTitle: settings.heroTitle || '', heroSubtitle: settings.heroSubtitle || '' } });
    }
    if (pathname === '/api/cart-products' && req.method === 'POST') {
      if (limited(req, 'cart-products', 240, 3600000)) return fail(res, 429, 'محاولات كثيرة');
      const input = await body(req, 5000);
      if (!Array.isArray(input.ids) || input.ids.length > 30) return fail(res, 400, 'قائمة المنتجات غير صالحة');
      const ids = [...new Set(input.ids.map(value => clean(value, 36)))];
      if (ids.some(value => !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))) return fail(res, 400, 'معرّف منتج غير صالح');
      const products = await storage.listProductsByIds(ids);
      return send(res, 200, { products: products.map(productForPublic) });
    }
    if (pathname === '/api/presence' && req.method === 'POST') {
      if (limited(req, 'presence', 240, 3600000)) return fail(res, 429, 'محاولات كثيرة');
      const input = await body(req, 1000), visitor = clean(input.visitor, 80);
      if (!/^[A-Za-z0-9_-]{12,80}$/.test(visitor)) return fail(res, 400, 'معرّف غير صالح');
      activeVisitors.set(visitor, Date.now()); return send(res, 200, { ok: true });
    }
    if (pathname === '/api/order' && req.method === 'POST') {
      if (limited(req, 'order', 120, 3600000)) return fail(res, 429, 'حاول مرة أخرى لاحقًا');
      const input = await body(req, 40000), c = input.customer || {}, lines = input.items;
      const name = clean(c.name, 100), phone = clean(c.phone, 25), city = clean(c.city, 80), address = clean(c.address, 300), notes = clean(c.notes, 500);
      if (name.length < 3 || !/^[+\d\s()-]{7,25}$/.test(phone) || !city || address.length < 5) return fail(res, 400, 'راجع الاسم والهاتف والمدينة والعنوان');
      if (!Array.isArray(lines) || lines.length < 1 || lines.length > 30) return fail(res, 400, 'السلة غير صالحة');
      const grouped = new Map();
      for (const line of lines) {
        const key = `${line.productId}:${line.size}`; const qty = positiveInt(line.qty, 20);
        if (!qty || !/^\d{2}$/.test(String(line.size))) return fail(res, 400, 'الكمية أو المقاس غير صالح');
        grouped.set(key, (grouped.get(key) || 0) + qty);
      }
      const requested = [];
      for (const [key, qty] of grouped) {
        if (qty > 20) return fail(res, 400, 'الحد الأقصى 20 قطعة من المقاس نفسه');
        const [productId, size] = key.split(':'); requested.push({ productId, size, qty });
      }
      if (limitedValue('order-phone', phone.replace(/\D/g, ''), 6, 3600000)) return fail(res, 429, 'تم إرسال طلبات كثيرة لهذا الرقم. حاول مرة أخرى لاحقًا');
      const draft = { id: id(), customer: { name, phone, city, address, notes }, lines: requested, createdAt: new Date().toISOString() };
      let order;
      try { order = await storage.createOrder(draft); }
      catch (error) {
        if (error.code === 'STOCK_CONFLICT') return fail(res, 409, 'منتج أو مقاس نفد من المخزون. حدّث السلة.');
        if (error.code === 'INVALID_CITY') return fail(res, 400, 'اختَر مدينة متاحة للتوصيل');
        throw error;
      }
      void notifyNewOrder(order);
      return send(res, 201, { number: order.number, total: order.total });
    }
    if (pathname === '/api/admin/session' && req.method === 'GET') { const person = await auth(req); return send(res, 200, { loggedIn: Boolean(person), configured: adminConfigured, user: person }); }
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (limited(req, 'login', 10, 900000)) return fail(res, 429, 'محاولات كثيرة. انتظر قليلًا.');
      if (!adminConfigured) return fail(res, 503, 'لم يُجهَّز حساب الإدارة بعد');
      const input = await body(req, 2000); const supplied = String(input.password || ''); const username = clean(input.username, 32).toLowerCase();
      let person;
      if (!username || username === 'owner') {
        const a = crypto.createHash('sha256').update(supplied).digest(); const b = crypto.createHash('sha256').update(adminPassword).digest();
        if (crypto.timingSafeEqual(a, b)) person = owner;
      } else {
        const staff = await storage.findStaffByUsername(username);
        const activeStaff = staff?.active ? staff : null;
        const salt = activeStaff?.salt || 'invalid-user-salt'; const expected = activeStaff?.hash || crypto.randomBytes(64).toString('hex');
        const actual = crypto.scryptSync(supplied, salt, 64).toString('hex');
        if (crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) person = activeStaff;
      }
      if (!person) return fail(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
      return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, session(person), 12 * 3600) });
    }
    if (pathname === '/api/admin/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });
    if (pathname.startsWith('/api/admin/')) {
      const person = await auth(req);
      if (!person) return fail(res, 401, 'سجّل الدخول أولًا');
      if (pathname === '/api/admin/live' && req.method === 'GET') return send(res, 200, { liveVisitors: liveVisitorCount() });
      if (pathname === '/api/admin/data' && req.method === 'GET') {
        const [products, orders, customers, settings, staff] = await Promise.all([
          can(person, 'products.view') ? storage.listProducts() : [],
          can(person, 'orders.view') ? storage.listOrders() : [],
          can(person, 'orders.view') ? storage.listCustomers() : [],
          can(person, 'settings.view') ? storage.getSettings() : null,
          person.owner ? storage.listStaff() : []
        ]);
        return send(res, 200, { user: person, liveVisitors: liveVisitorCount(), products, orders, customers, settings, telegramBotConfigured: Boolean(telegramBotToken), staff: staff.map(publicStaff) });
      }
      if (pathname === '/api/admin/staff' && req.method === 'POST') {
        if (!person.owner) return fail(res, 403, 'هذه العملية للمالك فقط');
        const currentStaff = await storage.listStaff();
        if (currentStaff.length >= 30) return fail(res, 400, 'الحد الأقصى 30 موظفًا');
        let staff; try { staff = validStaff(await body(req, 10000)); } catch (e) { return fail(res, 400, e.message); }
        if (await storage.staffUsernameExists(staff.username)) return fail(res, 400, 'اسم المستخدم مستخدم');
        try { await storage.saveStaff(staff); }
        catch (error) { if (error.code === '23505') return fail(res, 400, 'اسم المستخدم مستخدم'); throw error; }
        return send(res, 201, publicStaff(staff));
      }
      const staffMatch = pathname.match(/^\/api\/admin\/staff\/([a-f0-9-]+)$/);
      if (staffMatch && req.method === 'PUT') {
        if (!person.owner) return fail(res, 403, 'هذه العملية للمالك فقط');
        const existing = await storage.findStaffById(staffMatch[1]); if (!existing) return fail(res, 404, 'الموظف غير موجود');
        let updated; try { updated = validStaff(await body(req, 10000), existing); } catch (e) { return fail(res, 400, e.message); }
        if (await storage.staffUsernameExists(updated.username, existing.id)) return fail(res, 400, 'اسم المستخدم مستخدم');
        try { await storage.saveStaff(updated); }
        catch (error) { if (error.code === '23505') return fail(res, 400, 'اسم المستخدم مستخدم'); throw error; }
        return send(res, 200, publicStaff(updated));
      }
      if (pathname === '/api/admin/products' && req.method === 'POST') {
        if (!can(person, 'products.manage')) return fail(res, 403, 'ليس لديك صلاحية تعديل المنتجات');
        const input = await body(req, 100000); let p;
        try { p = validProduct(input); } catch (e) { return fail(res, 400, e.message); }
        if (await storage.productCodeExists(p.code)) return fail(res, 400, 'كود المنتج مستخدم');
        try { await storage.saveProduct(p); }
        catch (error) { if (error.code === '23505') return fail(res, 400, 'كود المنتج مستخدم'); throw error; }
        return send(res, 201, p);
      }
      const productMatch = pathname.match(/^\/api\/admin\/products\/([a-f0-9-]+)$/);
      if (productMatch && req.method === 'PUT') {
        if (!can(person, 'products.manage')) return fail(res, 403, 'ليس لديك صلاحية تعديل المنتجات');
        const existing = await storage.findProduct(productMatch[1]); if (!existing) return fail(res, 404, 'المنتج غير موجود');
        const input = await body(req, 100000);
        let updated; try { updated = validProduct(input, existing); } catch (e) { return fail(res, 400, e.message); }
        if (await storage.productCodeExists(updated.code, existing.id)) return fail(res, 400, 'كود المنتج مستخدم');
        try { await storage.saveProduct(updated); }
        catch (error) { if (error.code === '23505') return fail(res, 400, 'كود المنتج مستخدم'); throw error; }
        return send(res, 200, updated);
      }
      if (pathname === '/api/admin/upload' && req.method === 'POST') {
        const input = await body(req, 11_000_000); const raw = String(input.data || '');
        const needed = input.kind === 'homepage' ? 'settings.manage' : 'products.manage';
        if (!can(person, needed)) return fail(res, 403, 'ليس لديك صلاحية رفع هذه الصورة');
        if (!/^data:image\/(png|jpeg|webp);base64,/.test(raw)) return fail(res, 400, 'صيغة الصورة غير مدعومة');
        const buffer = Buffer.from(raw.split(',')[1], 'base64'); const ext = detectImage(buffer);
        if (!ext || buffer.length > 8_000_000) return fail(res, 400, 'الصورة غير صالحة أو أكبر من 8MB بعد التجهيز');
        const filename = `${id()}.${ext}`; fs.writeFileSync(path.join(uploadDir, filename), buffer, { mode: 0o644 });
        return send(res, 201, { url: `/uploads/${filename}` });
      }
      const orderMatch = pathname.match(/^\/api\/admin\/orders\/([a-f0-9-]+)$/);
      if (orderMatch && req.method === 'PATCH') {
        if (!can(person, 'orders.manage')) return fail(res, 403, 'ليس لديك صلاحية تعديل الطلبات');
        const input = await body(req, 2000); const status = clean(input.status, 30);
        if (!['جديد', 'تم التأكيد', 'جاري التجهيز', 'خرج للتوصيل', 'تم التسليم', 'ملغي', 'راجع'].includes(status)) return fail(res, 400, 'حالة غير صالحة');
        let updated;
        try { updated = await storage.updateOrderStatus(orderMatch[1], status, Boolean(input.restoreStock)); }
        catch (error) { if (error.code === 'STOCK_ALREADY_RESTORED') return fail(res, 409, 'أُرجعت كمية هذا الطلب للمخزون؛ لا يمكن تفعيله من جديد'); throw error; }
        if (!updated) return fail(res, 404, 'الطلب غير موجود');
        return send(res, 200, updated);
      }
      if (pathname === '/api/admin/settings' && req.method === 'PUT') {
        if (!can(person, 'settings.manage')) return fail(res, 403, 'ليس لديك صلاحية تعديل الإعدادات');
        const input = await body(req, 50000), delivery = {};
        const heroImage = clean(input.heroImage, 150), heroMobileImage = clean(input.heroMobileImage, 150);
        if (!validImagePath(heroImage) || !validImagePath(heroMobileImage)) return fail(res, 400, 'رابط صورة الواجهة غير صالح');
        for (const [city, fee] of Object.entries(input.delivery || {})) {
          const name = clean(city, 80), amount = positiveInt(fee, 10000);
          if (!name || amount === null) return fail(res, 400, 'أسعار التوصيل غير صالحة'); delivery[name] = amount;
        }
        const telegramChatId = clean(input.telegramChatId, 80);
        if (!validTelegramChatId(telegramChatId)) return fail(res, 400, 'وجهة تيليجرام غير صالحة. استخدم Chat ID رقميًا أو @username');
        const updated = { phone: clean(input.phone, 50), exchangePolicy: clean(input.exchangePolicy, 3000), privacyPolicy: clean(input.privacyPolicy, 5000), delivery, heroImage, heroMobileImage, heroTitle: clean(input.heroTitle, 100), heroSubtitle: clean(input.heroSubtitle, 240), telegramChatId };
        await storage.saveSettings(updated); return send(res, 200, updated);
      }
    }
    if (pathname.startsWith('/api/')) return fail(res, 404, 'غير موجود');
    if (pathname.startsWith('/uploads/')) {
      const name = pathname.slice('/uploads/'.length); if (!/^[a-f0-9-]+\.(png|jpg|webp)$/.test(name)) return fail(res, 404, 'غير موجود');
      return serveFile(res, path.join(uploadDir, name));
    }
    if (req.method !== 'GET') return fail(res, 405, 'طريقة غير مسموحة');
    const file = pathname === '/admin' ? 'admin.html' : pathname === '/' ? 'index.html' : pathname.slice(1);
    const resolved = path.resolve(publicDir, file);
    if (!resolved.startsWith(publicDir + path.sep) && resolved !== publicDir) return fail(res, 404, 'غير موجود');
    return serveFile(res, resolved);
  } catch (err) {
    console.error(err); fail(res, err instanceof SyntaxError ? 400 : 500, err instanceof SyntaxError ? 'البيانات غير صالحة' : 'حدث خطأ. حاول مرة أخرى.');
  }
});
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Ajeeb Outlet listening on ${port} (${storage.kind})`));

async function shutdown(signal) {
  console.log(`${signal}: shutting down`);
  server.close(async () => {
    try { await storage.close(); process.exit(0); }
    catch (error) { console.error(error); process.exit(1); }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

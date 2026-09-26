import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStorage } from '../storage.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajeeb-integration-api-test-'));
const resolvedTemp = path.resolve(tempDir);
if (!resolvedTemp.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error('Unsafe temporary test directory');

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const address = probe.address(); probe.close(() => resolve(address.port)); });
});
const origin = `http://127.0.0.1:${port}`;
let server;

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error('Integration test server exited before becoming healthy');
    try { const response = await fetch(`${origin}/healthz`); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Integration test server did not become healthy');
}

try {
  const storage = await createStorage({ dataDir: tempDir });
  await storage.saveSettings({ phone: '', exchangePolicy: '', privacyPolicy: '', delivery: { طرابلس: 10 }, heroImage: '', heroMobileImage: '', heroTitle: '', heroSubtitle: '', telegramChatId: '' });
  const product = { id: crypto.randomUUID(), code: 'API-TEST', name: 'منتج API', price: 90, oldPrice: 0, active: true, updatedAt: new Date().toISOString(), images: [], sizes: { 42: 2 } };
  await storage.saveProduct(product);
  const order = await storage.createOrder({ id: crypto.randomUUID(), customer: { name: 'عميل API', phone: '0911111111', city: 'طرابلس', address: 'عنوان اختبار التكامل', notes: '' }, lines: [{ productId: product.id, size: '42', qty: 1 }], createdAt: new Date().toISOString() });
  await storage.close();

  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: tempDir, HOST: '127.0.0.1', PORT: String(port), SITE_ORIGIN: origin, ADMIN_PASSWORD: 'integration-owner-password', ADMIN_PASSWORD_B64: '', SESSION_SECRET: 's'.repeat(64), TELEGRAM_BOT_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer();

  const login = await fetch(`${origin}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ username: '', password: 'integration-owner-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  assert.equal((await fetch(`${origin}/api/v1/orders`)).status, 401);
  const generated = await fetch(`${origin}/api/admin/integration-keys/orders`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(generated.status, 201);
  const first = await generated.json();
  assert.match(first.apiKey, /^ajeeb_live_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/);
  assert.equal(first.integrationApiKey.scopes[0], 'orders.read');

  const ordersResponse = await fetch(`${origin}/api/v1/orders?after=0&limit=1`, { headers: { authorization: `Bearer ${first.apiKey}` } });
  assert.equal(ordersResponse.status, 200);
  const orders = await ordersResponse.json();
  assert.equal(orders.data[0].number, order.number);
  assert.equal(orders.data[0].customer.phone, '0911111111');
  assert.equal(orders.data[0].items[0].code, product.code);
  assert.equal(orders.pagination.nextAfter, order.number);

  const adminData = await fetch(`${origin}/api/admin/data`, { headers: { cookie } }).then(response => response.json());
  assert.equal(adminData.integrationApiKey.prefix, first.integrationApiKey.prefix);
  assert.equal(Object.hasOwn(adminData.integrationApiKey, 'apiKey'), false);

  const rotatedResponse = await fetch(`${origin}/api/admin/integration-keys/orders`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(rotatedResponse.status, 201);
  const rotated = await rotatedResponse.json();
  assert.notEqual(rotated.apiKey, first.apiKey);
  assert.equal((await fetch(`${origin}/api/v1/orders`, { headers: { authorization: `Bearer ${first.apiKey}` } })).status, 401);
  assert.equal((await fetch(`${origin}/api/v1/orders`, { headers: { authorization: `Bearer ${rotated.apiKey}` } })).status, 200);

  const revoked = await fetch(`${origin}/api/admin/integration-keys/orders`, { method: 'DELETE', headers: { cookie, origin } });
  assert.equal(revoked.status, 200);
  assert.equal((await fetch(`${origin}/api/v1/orders`, { headers: { authorization: `Bearer ${rotated.apiKey}` } })).status, 401);
  console.log('Integration API smoke test passed');
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000); });
  }
  fs.rmSync(resolvedTemp, { recursive: true, force: true });
}

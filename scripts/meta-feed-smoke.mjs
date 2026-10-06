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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajeeb-meta-feed-test-'));
const resolvedTemp = path.resolve(tempDir);
if (!resolvedTemp.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)) throw new Error('Unsafe temporary test directory');

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject); probe.listen(0, '127.0.0.1', () => { const address = probe.address(); probe.close(() => resolve(address.port)); });
});
const origin = `http://127.0.0.1:${port}`;
let server;

function parseCsv(input) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { value += '"'; index++; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(value); value = ''; }
    else if (character === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error('Meta feed test server exited before becoming healthy');
    try { const response = await fetch(`${origin}/healthz`); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Meta feed test server did not become healthy');
}

try {
  const storage = await createStorage({ dataDir: tempDir });
  await storage.saveSettings({ phone: '', exchangePolicy: '', privacyPolicy: '', delivery: {}, heroImage: '', heroMobileImage: '', heroTitle: '', heroSubtitle: '', telegramChatId: '', metaPixelId: '' });
  const activeProduct = { id: crypto.randomUUID(), code: 'AJ-2146', name: 'حذاء "اختبار", مريح', price: 260, oldPrice: 310, active: true, updatedAt: new Date().toISOString(), images: ['/featured-banner.jpg'], sizes: { 40: 3, 41: 0 } };
  const inactiveProduct = { id: crypto.randomUUID(), code: 'HIDDEN-1', name: 'منتج غير منشور', price: 100, oldPrice: 0, active: false, updatedAt: new Date().toISOString(), images: ['/featured-banner.jpg'], sizes: { 42: 5 } };
  await storage.saveProduct(activeProduct);
  await storage.saveProduct(inactiveProduct);
  await storage.close();

  server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: tempDir, HOST: '127.0.0.1', PORT: String(port), SITE_ORIGIN: origin, ADMIN_PASSWORD: 'meta-feed-owner-password', ADMIN_PASSWORD_B64: '', SESSION_SECRET: 's'.repeat(64), TELEGRAM_BOT_TOKEN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForServer();

  const response = await fetch(`${origin}/feeds/meta-products.csv`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/csv; charset=UTF-8');
  assert.equal(response.headers.get('content-disposition'), 'inline; filename="ajeeb-meta-products.csv"');
  assert.match(response.headers.get('cache-control') || '', /max-age=300/);
  const csv = await response.text();
  assert.notEqual(csv.charCodeAt(0), 0xfeff);
  assert.doesNotMatch(csv, /<!doctype|<html/i);
  assert.match(csv, /"حذاء ""اختبار"", مريح"/);

  const rows = parseCsv(csv);
  assert.deepEqual(rows[0], ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'item_group_id', 'size']);
  assert.equal(rows.length, 3);
  const stock40 = rows.find(row => row[0] === 'AJ-2146-40');
  const stock41 = rows.find(row => row[0] === 'AJ-2146-41');
  assert.ok(stock40);
  assert.ok(stock41);
  assert.equal(stock40[3], 'in stock');
  assert.equal(stock41[3], 'out of stock');
  assert.equal(stock40[5], '260 LYD');
  assert.equal(stock40[8], 'Ajeeb');
  assert.equal(stock40[9], 'AJ-2146');
  assert.equal(stock40[10], '40');
  assert.ok(rows.every(row => !row.includes('HIDDEN-1')));

  const productLink = new URL(stock40[6]);
  assert.equal(productLink.origin, origin);
  assert.equal(productLink.searchParams.get('product'), activeProduct.id);
  assert.equal(productLink.searchParams.get('size'), '40');
  const productPage = await fetch(productLink);
  assert.equal(productPage.status, 200);
  assert.match(await productPage.text(), /id="productModal"/);

  const imageLink = new URL(stock40[7]);
  assert.equal(imageLink.origin, origin);
  assert.equal((await fetch(imageLink)).status, 200);
  assert.equal((await fetch(`${origin}/feeds/meta-products.csv`, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(`${origin}/feeds/meta-products.csv`, { method: 'POST' })).status, 405);
  console.log('Meta product feed smoke test passed');
} finally {
  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolve => { server.once('exit', resolve); setTimeout(resolve, 3000); });
  }
  fs.rmSync(resolvedTemp, { recursive: true, force: true });
}

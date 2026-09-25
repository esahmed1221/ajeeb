import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '../storage.mjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajeeb-storage-test-'));
const legacyTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ajeeb-storage-legacy-test-'));
const resolvedTemp = path.resolve(tempDir);
const resolvedLegacyTemp = path.resolve(legacyTempDir);
const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
if (!resolvedTemp.startsWith(tempRoot) || !resolvedLegacyTemp.startsWith(tempRoot)) throw new Error('Unsafe temporary test directory');

let storage;
let legacyStorage;
try {
  storage = await createStorage({ dataDir: tempDir });
  await storage.saveSettings({ phone: '', exchangePolicy: '', privacyPolicy: '', delivery: { طرابلس: 10 }, heroImage: '', heroMobileImage: '', heroTitle: '', heroSubtitle: '', telegramChatId: '-1001234567890' });
  assert.equal((await storage.getSettings()).telegramChatId, '-1001234567890');

  const product = { id: crypto.randomUUID(), code: 'TEST-1', name: 'منتج اختبار', price: 120, oldPrice: 150, active: true, updatedAt: new Date().toISOString(), images: [], sizes: { 42: 3 } };
  await storage.saveProduct(product);
  assert.equal(await storage.productCodeExists(product.code), true);
  assert.equal((await storage.listProducts({ activeOnly: true }))[0].sizes['42'], 3);

  const order = await storage.createOrder({ id: crypto.randomUUID(), customer: { name: 'عميل اختبار', phone: '0910000000', city: 'طرابلس', address: 'عنوان اختبار صالح', notes: '' }, lines: [{ productId: product.id, size: '42', qty: 2 }], createdAt: new Date().toISOString() });
  assert.equal(order.number, '5000');
  assert.equal(order.subtotal, 240);
  assert.equal(order.total, 250);
  assert.equal((await storage.findProduct(product.id)).sizes['42'], 1);
  assert.equal((await storage.listOrders()).length, 1);
  const firstCustomers = await storage.listCustomers();
  assert.equal(firstCustomers.length, 1);
  assert.equal(firstCustomers[0].id, order.customerId);
  assert.equal(firstCustomers[0].orderCount, 1);

  const cancelled = await storage.updateOrderStatus(order.id, 'ملغي', true);
  assert.equal(cancelled.stockRestored, true);
  assert.equal((await storage.findProduct(product.id)).sizes['42'], 3);

  const repeatOrder = await storage.createOrder({ id: crypto.randomUUID(), customer: { name: 'عميل اختبار محدّث', phone: '(091) 000-0000', city: 'طرابلس', address: 'عنوان اختبار جديد', notes: '' }, lines: [{ productId: product.id, size: '42', qty: 1 }], createdAt: new Date().toISOString() });
  assert.equal(repeatOrder.number, '5001');
  const customers = await storage.listCustomers();
  assert.equal(customers.length, 1);
  assert.equal(repeatOrder.customerId, order.customerId);
  assert.equal(customers[0].name, 'عميل اختبار محدّث');
  assert.equal(customers[0].orderCount, 2);
  assert.equal(customers[0].totalSpent, 130);

  const pageProducts = [];
  for (let index = 0; index < 16; index++) {
    const pagedProduct = { id: crypto.randomUUID(), code: `PAGE-${index}`, name: `منتج صفحة ${index}`, price: 50 + index, oldPrice: 0, active: true, updatedAt: new Date(Date.now() + index + 1000).toISOString(), images: [], sizes: index === 15 ? { 43: 1 } : { 42: 1 } };
    pageProducts.push(pagedProduct); await storage.saveProduct(pagedProduct);
  }
  const firstPage = await storage.listCatalogPage({ page: 1, pageSize: 15 });
  const secondPage = await storage.listCatalogPage({ page: 2, pageSize: 15 });
  assert.equal(firstPage.products.length, 15);
  assert.equal(firstPage.totalItems, 17);
  assert.equal(firstPage.totalPages, 2);
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.products.length, 2);
  assert.equal((await storage.listCatalogPage({ page: 1, pageSize: 15, query: 'PAGE-15' })).totalItems, 1);
  assert.equal((await storage.listCatalogPage({ page: 1, pageSize: 15, size: '43' })).totalItems, 1);
  assert.deepEqual(await storage.listAvailableSizes(), ['42', '43']);
  assert.equal((await storage.listProductsByIds([product.id, pageProducts[0].id])).length, 2);
  const deletedProduct = await storage.deleteProduct(product.id);
  assert.equal(deletedProduct.id, product.id);
  assert.equal(await storage.findProduct(product.id), null);
  assert.equal((await storage.listOrders()).find(item => item.id === repeatOrder.id).items[0].code, product.code);
  const cancelledDeletedProductOrder = await storage.updateOrderStatus(repeatOrder.id, 'ملغي', true);
  assert.equal(cancelledDeletedProductOrder.stockRestored, true);
  assert.equal(await storage.deleteProduct(product.id), null);

  const now = new Date().toISOString();
  const staff = { id: crypto.randomUUID(), name: 'موظف اختبار', username: 'test.staff', active: true, permissions: ['orders.view'], salt: 'test-salt', hash: 'test-hash', sessionVersion: 1, createdAt: now, updatedAt: now };
  await storage.saveStaff(staff);
  assert.equal((await storage.findStaffByUsername(staff.username)).id, staff.id);

  const legacyOrderId = crypto.randomUUID();
  fs.writeFileSync(path.join(legacyTempDir, 'store.json'), JSON.stringify({
    products: [], staff: [], settings: { delivery: {} },
    orders: [{ id: legacyOrderId, number: 'LEGACY-1', customer: { name: 'عميل قديم', phone: '0920000000', city: 'بنغازي', address: 'عنوان قديم', notes: '' }, items: [], subtotal: 100, delivery: 20, total: 120, status: 'تم التسليم', stockRestored: false, createdAt: '2025-01-01T00:00:00.000Z' }]
  }));
  legacyStorage = await createStorage({ dataDir: legacyTempDir });
  const migratedOrders = await legacyStorage.listOrders();
  const migratedCustomers = await legacyStorage.listCustomers();
  assert.equal(migratedCustomers.length, 1);
  assert.equal(migratedOrders[0].number, '1');
  assert.equal(migratedOrders[0].customerId, migratedCustomers[0].id);
  console.log('Storage smoke test passed');
} finally {
  if (storage) await storage.close();
  if (legacyStorage) await legacyStorage.close();
  fs.rmSync(resolvedTemp, { recursive: true, force: true });
  fs.rmSync(resolvedLegacyTemp, { recursive: true, force: true });
}

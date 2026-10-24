import assert from 'node:assert/strict';
import fs from 'node:fs';
import { answerInventoryQuestion, normalizeInventoryQuestion } from '../public/inventory-assistant.js';

const adminHtml = fs.readFileSync(new URL('../public/admin.html', import.meta.url), 'utf8');
const adminScript = fs.readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
assert.match(adminHtml, /data-tab="assistantTab"/);
assert.match(adminHtml, /id="inventoryAssistantForm"/);
assert.match(adminHtml, /admin-assistant\.css\?v=1/);
assert.match(adminScript, /answerInventoryQuestion/);

const products = [
  { id: 'a', code: 'A100', name: 'حذاء ألف', active: true, images: ['/a.jpg'], sizes: { 40: 2, 41: 3 } },
  { id: 'b', code: 'B200', name: 'حذاء باء', active: true, images: [], sizes: { 42: 10 } },
  { id: 'c', code: 'C300', name: 'حذاء جيم', active: false, images: [], sizes: { 40: 0, 44: 0 } },
  { id: 'd', code: 'D400', name: 'حذاء دال', active: true, images: [], sizes: { 40: 1, 41: 1, 42: 1 } }
];

assert.equal(normalizeInventoryQuestion('مقاس ٤٢'), 'مقاس 42');

let answer = answerInventoryQuestion(products, 'نبي الموديلات اللي فيها مقاسات أكثر');
assert.equal(answer.intent, 'most-sizes');
assert.equal(answer.items[0].code, 'D400');
assert.equal(answer.items[0].sizeCount, 3);

answer = answerInventoryQuestion(products, 'شن أعلى المنتجات في كمية المخزون؟');
assert.equal(answer.intent, 'most-stock');
assert.equal(answer.items[0].code, 'B200');
assert.equal(answer.items[0].totalStock, 10);

answer = answerInventoryQuestion(products, 'شن المتوفر في مقاس ٤٢؟');
assert.equal(answer.intent, 'size');
assert.deepEqual(answer.items.map(item => item.code), ['B200', 'D400']);
assert.equal(answer.items[0].focusStock, 10);

answer = answerInventoryQuestion(products, 'عطني مخزون كود A100');
assert.equal(answer.intent, 'product');
assert.equal(answer.items[0].totalStock, 5);

answer = answerInventoryQuestion(products, 'شن المنتجات النافدة من المخزون؟');
assert.equal(answer.intent, 'out-of-stock');
assert.equal(answer.items[0].code, 'C300');

answer = answerInventoryQuestion(products, 'نبي ملخص إجمالي المخزون وعدد المنتجات');
assert.equal(answer.intent, 'summary');
assert.match(answer.message, /18 قطعة/);

answer = answerInventoryQuestion(products, 'سؤال غير معروف');
assert.equal(answer.intent, 'help');

console.log('Inventory assistant smoke test passed');

import assert from 'node:assert/strict';
import { sendTelegramOrder, telegramOrderText, validTelegramChatId } from '../telegram.mjs';

const order = {
  number: 'AJ-TEST-1',
  total: 265,
  customer: { name: 'أحمد', phone: '0944671424', city: 'طرابلس' },
  items: [
    { code: 'SH 1778', size: '43', qty: 1 },
    { code: 'SH 2040', size: '41', qty: 2 }
  ]
};
assert.equal(telegramOrderText(order), 'طلب جديد في متجر عجيب\nرقم الطلب: AJ-TEST-1\n\nاسم الزبون: أحمد\nرقم الهاتف: 0944671424\nالمنطقة: طرابلس\n\nتفاصيل الطلب:\n1. كود الحذاء: SH 1778 | المقاس: 43 | الكمية: 1\n2. كود الحذاء: SH 2040 | المقاس: 41 | الكمية: 2\n\nقيمة الطلب: 265 د.ل');
assert.equal(validTelegramChatId('123456789'), true);
assert.equal(validTelegramChatId('-1001234567890'), true);
assert.equal(validTelegramChatId('@ajeeb_orders'), true);
assert.equal(validTelegramChatId('0944671424'), false);
assert.equal(validTelegramChatId('not a chat'), false);

let request;
const result = await sendTelegramOrder({
  token: '123:test-token',
  chatId: '-1001234567890',
  order,
  signal: undefined,
  fetchImpl: async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
});

assert.deepEqual(result, { sent: true });
assert.equal(request.url, 'https://api.telegram.org/bot123:test-token/sendMessage');
assert.equal(request.options.method, 'POST');
assert.deepEqual(JSON.parse(request.options.body), { chat_id: '-1001234567890', text: telegramOrderText(order) });
assert.deepEqual(await sendTelegramOrder({ token: '', chatId: '-1001234567890', order }), { sent: false, reason: 'not-configured' });
console.log('Telegram smoke test passed');

const telegramUsername = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;
const telegramNumericId = /^-?[1-9]\d{4,19}$/;

export function validTelegramChatId(value) {
  const chatId = String(value ?? '').trim();
  return chatId === '' || telegramNumericId.test(chatId) || telegramUsername.test(chatId);
}

export function telegramOrderText(order) {
  const customer = order.customer || {};
  const items = Array.isArray(order.items) ? order.items : [];
  const total = Number(order.total || 0).toLocaleString('en-US');
  const itemLines = items.length
    ? items.map((item, index) => `${index + 1}. كود الحذاء: ${item.code || '—'} | المقاس: ${item.size || '—'} | الكمية: ${Number(item.qty || 0)}`).join('\n')
    : '—';
  return [
    'طلب جديد في متجر عجيب',
    `رقم الطلب: ${order.number}`,
    '',
    `اسم الزبون: ${customer.name || '—'}`,
    `رقم الهاتف: ${customer.phone || '—'}`,
    `المنطقة: ${customer.city || '—'}`,
    '',
    'تفاصيل الطلب:',
    itemLines,
    '',
    `قيمة الطلب: ${total} د.ل`
  ].join('\n');
}

export async function sendTelegramOrder({ token, chatId, order, fetchImpl = fetch, signal = AbortSignal.timeout(5000) }) {
  const destination = String(chatId ?? '').trim();
  if (!token || !destination) return { sent: false, reason: 'not-configured' };

  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: destination, text: telegramOrderText(order) }),
    signal
  });
  if (!response.ok) throw new Error(`Telegram sendMessage returned HTTP ${response.status}`);
  const payload = await response.json().catch(() => null);
  if (!payload?.ok) throw new Error('Telegram sendMessage was rejected');
  return { sent: true };
}

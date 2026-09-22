const telegramUsername = /^@[A-Za-z][A-Za-z0-9_]{4,31}$/;
const telegramNumericId = /^-?[1-9]\d{4,19}$/;

export function validTelegramChatId(value) {
  const chatId = String(value ?? '').trim();
  return chatId === '' || telegramNumericId.test(chatId) || telegramUsername.test(chatId);
}

export function telegramOrderText(order) {
  const total = Number(order.total || 0).toLocaleString('en-US');
  return `طلب جديد في متجر عجيب\nرقم الطلب: ${order.number}\nقيمة الطلب: ${total} د.ل`;
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

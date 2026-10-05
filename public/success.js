import { initMetaPixel, trackMetaEvent } from './meta-pixel.js';

let order;
try { order = JSON.parse(sessionStorage.getItem('ajeeb_last_order') || '{}'); } catch { order = {}; }
document.getElementById('orderNumber').textContent = order.number || '—';
document.getElementById('orderTotal').textContent = order.total === undefined ? '' : `الإجمالي مع التوصيل: ${Number(order.total).toLocaleString('ar-LY')} د.ل`;
if (order.number && initMetaPixel(order.metaPixelId)) {
  const sentKey = `ajeeb_pixel_purchase_${order.number}`;
  if (!sessionStorage.getItem(sentKey) && trackMetaEvent('Purchase', order.pixel || { value: Number(order.total || 0), currency: 'LYD' }, { eventID: `ajeeb-order-${order.number}` })) sessionStorage.setItem(sentKey, '1');
}

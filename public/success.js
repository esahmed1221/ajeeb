let order;
try { order = JSON.parse(sessionStorage.getItem('ajeeb_last_order') || '{}'); } catch { order = {}; }
document.getElementById('orderNumber').textContent = order.number || '—';
document.getElementById('orderTotal').textContent = order.total === undefined ? '' : `الإجمالي مع التوصيل: ${Number(order.total).toLocaleString('ar-LY')} د.ل`;

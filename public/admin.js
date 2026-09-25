const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => `${Number(n || 0).toLocaleString('ar-LY')} د.ل`;
const statuses = ['جديد', 'تم التأكيد', 'جاري التجهيز', 'خرج للتوصيل', 'تم التسليم', 'ملغي', 'راجع'];
const permissionGroups = [
  { title: 'الطلبات', view: 'orders.view', manage: 'orders.manage' },
  { title: 'المنتجات', view: 'products.view', manage: 'products.manage' },
  { title: 'إعدادات المتجر', view: 'settings.view', manage: 'settings.manage' }
];
let db = { products: [], orders: [], customers: [], staff: [], settings: null, user: null }, imageUrls = [];
let heroImages = { heroImage: '', heroMobileImage: '' };
const previewUrls = {};
let presenceTimer;

async function api(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (res.status === 413 ? 'الصورة كبيرة جدًا. جرّب صورة أصغر.' : res.status === 401 ? 'انتهت جلسة الدخول. حدّث الصفحة وادخل من جديد.' : `تعذر الحفظ (${res.status}). حاول مرة أخرى.`));
  return data;
}
function error(id, message) { $(id).textContent = message; $(id).classList.remove('hidden'); }
function clearError(id) { $(id).classList.add('hidden'); }
function can(permission) { return db.user?.owner || db.user?.permissions?.includes(permission) || (permission.endsWith('.view') && db.user?.permissions?.includes(permission.replace('.view', '.manage'))); }
function showTab(id) {
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('active', x.dataset.tab === id));
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('hidden', x.id !== id));
}
async function load() {
  db = await api('/api/admin/data');
  if (!Array.isArray(db.customers)) db.customers = [];
  $('loginBox').classList.add('hidden'); $('dashboard').classList.remove('hidden'); $('logout').classList.remove('hidden');
  $('greeting').textContent = db.user.name; $('accountLabel').textContent = db.user.owner ? 'حساب المالك' : `حساب ${db.user.name}`;
  const access = { overviewTab: can('orders.view'), ordersTab: can('orders.view'), customersTab: can('orders.view'), productsTab: can('products.view'), staffTab: db.user.owner, settingsTab: can('settings.view') };
  document.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('hidden', !access[x.dataset.tab]));
  $('noAccess').classList.toggle('hidden', Object.values(access).some(Boolean));
  const current = document.querySelector('[data-tab].active');
  if (!current || !access[current.dataset.tab]) {
    const first = document.querySelector('[data-tab]:not(.hidden)');
    if (first) showTab(first.dataset.tab);
    else document.querySelectorAll('.tab').forEach(x => x.classList.add('hidden'));
  }
  $('newProduct').classList.toggle('hidden', !can('products.manage'));
  $('settingsForm').querySelectorAll('input,textarea,button').forEach(x => x.disabled = !can('settings.manage'));
  $('liveVisitors').textContent = db.liveVisitors || 0;
  if (!$('overviewDate').value) $('overviewDate').value = localDay(new Date().toISOString());
  if (!presenceTimer) { presenceTimer = setInterval(refreshPresence, 20000); refreshPresence(); }
  render();
}
function render() { renderStats(); renderOrders(); renderCustomers(); renderProducts(); renderStaff(); if (db.settings) renderSettings(); }
function ordersOn(day) { return db.orders.filter(o => localDay(o.createdAt) === day); }
function dayShift(day, amount) { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + amount); return localDay(d.toISOString()); }
function trend(current, previous) {
  if (!previous) return current ? 'بداية النشاط' : 'بدون تغيير عن اليوم السابق';
  const value = Math.round(((current - previous) / previous) * 100);
  return `${value >= 0 ? '↑' : '↓'} ${Math.abs(value)}% عن اليوم السابق`;
}
async function refreshPresence() { try { const data = await api('/api/admin/live'); $('liveVisitors').textContent = data.liveVisitors || 0; } catch {} }
function renderStats() {
  const day = $('overviewDate').value || localDay(new Date().toISOString()), selected = ordersOn(day), previous = ordersOn(dayShift(day, -1));
  const valid = list => list.filter(o => !['ملغي', 'راجع'].includes(o.status));
  const sales = list => valid(list).reduce((sum, o) => sum + Number(o.total || 0), 0);
  const selectedSales = sales(selected), previousSales = sales(previous), count = status => selected.filter(o => o.status === status).length;
  const label = new Date(`${day}T12:00:00`).toLocaleDateString('ar-LY', { weekday: 'long', day: 'numeric', month: 'long' });
  $('analyticsDayTitle').textContent = day === localDay(new Date().toISOString()) ? 'مبيعات اليوم' : `مبيعات ${label}`;
  $('daySales').textContent = money(selectedSales); $('dayOrders').textContent = selected.length; $('dayAverage').textContent = money(selected.length ? Math.round(selectedSales / selected.length) : 0);
  $('salesTrend').textContent = trend(selectedSales, previousSales); $('ordersTrend').textContent = trend(selected.length, previous.length);
  $('deliveredSales').textContent = money(selected.filter(o => o.status === 'تم التسليم').reduce((sum, o) => sum + Number(o.total || 0), 0));
  $('pendingSales').textContent = money(selected.filter(o => !['تم التسليم', 'ملغي', 'راجع'].includes(o.status)).reduce((sum, o) => sum + Number(o.total || 0), 0));
  $('cancelledOrders').textContent = selected.filter(o => ['ملغي', 'راجع'].includes(o.status)).length;
  $('orderStat').textContent = selected.length;
  $('newStat').textContent = count('جديد');
  $('confirmedStat').textContent = count('تم التأكيد');
  $('deliveredStat').textContent = count('تم التسليم');
  $('productStat').textContent = can('products.view') ? db.products.length : '—';
  const chartDays = Array.from({ length: 7 }, (_, i) => dayShift(day, i - 6));
  const chartValues = chartDays.map(d => sales(ordersOn(d))), max = Math.max(...chartValues, 1);
  $('salesChart').innerHTML = chartDays.map((d, i) => `<div class="chart-column" title="${esc(`${d}: ${money(chartValues[i])}`)}"><strong>${chartValues[i] ? Number(chartValues[i]).toLocaleString('ar-LY') : '0'}</strong><div><i style="height:${Math.max(chartValues[i] ? 10 : 2, Math.round(chartValues[i] / max * 100))}%"></i></div><span>${esc(new Date(`${d}T12:00:00`).toLocaleDateString('ar-LY', { weekday: 'short' }))}</span></div>`).join('');
  $('recentOrders').innerHTML = db.orders.length ? db.orders.slice(0, 5).map(o => `<div class="recent-row"><div><b>${esc(o.number)}</b><small>${esc(o.customer.name)} · ${esc(o.customer.city)}</small></div><span class="status-pill">${esc(o.status)}</span><strong>${money(o.total)}</strong></div>`).join('') : '<p class="empty-list">ما فيش طلبات توا.</p>';
}
function renderProducts() {
  $('productList').innerHTML = db.products.length ? db.products.map(p => `<div class="admin-row"><div>${p.images?.[0] ? `<img src="${esc(p.images[0])}" alt="">` : '<span class="empty-img">👟</span>'}</div><div><h3>${esc(p.name)} <span class="status-pill">${p.active ? 'ظاهر' : 'مخفي'}</span></h3><p>${esc(p.code)} • ${money(p.price)} • ${Object.values(p.sizes).reduce((a, b) => a + b, 0)} قطعة</p></div>${can('products.manage') ? `<div class="admin-product-actions"><button data-edit="${p.id}">تعديل</button><button class="product-delete" data-delete-product="${p.id}">حذف نهائي</button></div>` : ''}</div>`).join('') : '<p class="empty-list">ما فيش منتجات.</p>';
  $('productList').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(db.products.find(p => p.id === b.dataset.edit)));
  $('productList').querySelectorAll('[data-delete-product]').forEach(button => button.onclick = async () => {
    const product = db.products.find(item => item.id === button.dataset.deleteProduct);
    if (!product || !confirm(`حذف «${product.name}» نهائيًا؟\n\nسيُحذف المنتج ومخزونه وصوره، ولا يمكن التراجع. ستبقى بياناته داخل الطلبات القديمة فقط.`)) return;
    button.disabled = true;
    try { await api(`/api/admin/products/${product.id}`, { method: 'DELETE' }); await load(); }
    catch (e) { button.disabled = false; alert(e.message); }
  });
}
function localDay(iso) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function renderOrders() {
  const q = $('orderSearch').value.trim().toLowerCase(), status = $('statusFilter').value, from = $('dateFrom').value, to = $('dateTo').value;
  const orders = db.orders.filter(o => {
    const day = localDay(o.createdAt);
    const itemSearch = o.items.map(i => `${i.code || ''} ${i.name || ''} ${i.size || ''}`).join(' ');
    return (!q || `${o.number} ${o.customer.phone} ${o.customer.city} ${o.customer.address} ${o.customer.name} ${itemSearch}`.toLowerCase().includes(q)) && (!status || o.status === status) && (!from || day >= from) && (!to || day <= to);
  });
  $('ordersCount').textContent = `${db.orders.length} طلب`;
  $('ordersNewCount').textContent = db.orders.filter(o => o.status === 'جديد').length;
  $('ordersActiveCount').textContent = db.orders.filter(o => ['تم التأكيد', 'جاري التجهيز', 'خرج للتوصيل'].includes(o.status)).length;
  $('ordersDeliveredCount').textContent = db.orders.filter(o => o.status === 'تم التسليم').length;
  $('ordersValue').textContent = money(db.orders.filter(o => !['ملغي', 'راجع'].includes(o.status)).reduce((sum, o) => sum + Number(o.total || 0), 0));
  $('filterCount').textContent = `${orders.length} طلب مطابق`;
  $('filterTotal').textContent = `إجمالي المعروض: ${money(orders.reduce((sum, o) => sum + Number(o.total || 0), 0))}`;
  $('orderList').innerHTML = orders.length ? `<div class="orders-table-wrap"><div class="orders-table"><div class="orders-header"><span>الطلب</span><span>الزبون</span><span>الهاتف</span><span>المنطقة</span><span>كود الحذاء / المقاس</span><span>الإجمالي</span><span>الحالة</span><span>المخزون</span><span></span></div>${orders.map(o => `<article class="compact-order-row"><div class="compact-order-id"><strong>${esc(o.number)}</strong><time>${esc(new Date(o.createdAt).toLocaleDateString('ar-LY'))}</time></div><strong class="compact-customer">${esc(o.customer.name)}</strong><a class="phone-link" href="tel:${esc(o.customer.phone)}">${esc(o.customer.phone)}</a><div class="compact-location" title="${esc(`${o.customer.city} — ${o.customer.address}${o.customer.notes ? ` — ملاحظات: ${o.customer.notes}` : ''}`)}"><strong>${esc(o.customer.city)}</strong><span>${esc(o.customer.address)}</span></div><div class="compact-products" title="${esc(o.items.map(i => `${i.name} - ${i.code || '—'} - مقاس ${i.size} × ${i.qty}`).join('، '))}">${o.items.map(i => `<span><b>${esc(i.code || '—')}</b> / مقاس ${esc(i.size)} × ${Number(i.qty || 0)}</span>`).join('')}</div><strong class="compact-total">${money(o.total)}</strong>${can('orders.manage') ? `<select data-status="${o.id}" aria-label="حالة الطلب">${statuses.map(s => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select><label class="compact-restore"><input type="checkbox" data-restore="${o.id}" ${o.stockRestored ? 'disabled' : ''}> إرجاع</label><button class="compact-save" data-save-order="${o.id}">حفظ</button>` : `<span class="status-pill">${esc(o.status)}</span><span>—</span><span>—</span>`}</article>`).join('')}</div></div>` : '<p class="empty-list">ما فيش طلبات مطابقة للفلاتر.</p>';
  $('orderList').querySelectorAll('[data-save-order]').forEach(b => b.onclick = async () => {
    const id = b.dataset.saveOrder, status = document.querySelector(`[data-status="${id}"]`).value, restoreStock = document.querySelector(`[data-restore="${id}"]`).checked;
    if (restoreStock && !confirm('تأكيد إرجاع الكمية للمخزون لهذا الطلب؟')) return;
    try { await api(`/api/admin/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status, restoreStock }) }); await load(); } catch (e) { alert(e.message); }
  });
}
function renderCustomers() {
  const all = db.customers || [], q = $('customerSearch').value.trim().toLowerCase(), sort = $('customerSort').value;
  const customers = all.filter(customer => !q || `${customer.name} ${customer.phone} ${customer.city} ${customer.address}`.toLowerCase().includes(q));
  if (sort === 'orders') customers.sort((a, b) => Number(b.orderCount) - Number(a.orderCount) || String(b.lastOrderAt || '').localeCompare(String(a.lastOrderAt || '')));
  else if (sort === 'value') customers.sort((a, b) => Number(b.totalSpent) - Number(a.totalSpent) || Number(b.orderCount) - Number(a.orderCount));
  else if (sort === 'name') customers.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
  else customers.sort((a, b) => String(b.lastOrderAt || b.updatedAt || '').localeCompare(String(a.lastOrderAt || a.updatedAt || '')));
  $('customerTotal').textContent = `${all.length} زبون`;
  $('repeatCustomerTotal').textContent = all.filter(customer => Number(customer.orderCount) > 1).length;
  $('customerOrdersTotal').textContent = all.reduce((sum, customer) => sum + Number(customer.orderCount || 0), 0);
  $('customerValueTotal').textContent = money(all.reduce((sum, customer) => sum + Number(customer.totalSpent || 0), 0));
  $('customerMatchCount').textContent = `${customers.length} زبون مطابق`;
  $('customerList').innerHTML = customers.length ? `<div class="customer-list-head"><span>الزبون</span><span>الهاتف</span><span>المدينة والعنوان</span><span>الطلبات</span><span>القيمة</span><span>آخر طلب</span><span></span></div>${customers.map(customer => `<article class="customer-row"><div class="customer-main"><span class="customer-avatar">${esc(String(customer.name || '؟').slice(0, 1))}</span><div><strong>${esc(customer.name)}</strong><small>مسجل منذ ${esc(new Date(customer.createdAt).toLocaleDateString('ar-LY'))}</small></div></div><div class="customer-contact"><small>الهاتف</small><a href="tel:${esc(customer.phone)}">${esc(customer.phone)}</a></div><div class="customer-address"><small>المدينة والعنوان</small><strong>${esc(customer.city)}</strong><span>${esc(customer.address)}</span></div><div class="customer-orders"><small>الطلبات</small><strong>${Number(customer.orderCount || 0)}</strong></div><div class="customer-value"><small>القيمة</small><strong>${money(customer.totalSpent)}</strong></div><div class="customer-last"><small>آخر طلب</small><strong>${customer.lastOrderAt ? esc(new Date(customer.lastOrderAt).toLocaleDateString('ar-LY')) : '—'}</strong></div><button class="customer-orders-button" data-customer-orders="${esc(customer.phone)}">عرض الطلبات</button></article>`).join('')}` : '<p class="empty-list">ما فيش زبائن مطابقين للبحث.</p>';
  $('customerList').querySelectorAll('[data-customer-orders]').forEach(button => button.onclick = () => {
    $('orderSearch').value = button.dataset.customerOrders;
    ['statusFilter', 'dateFrom', 'dateTo'].forEach(id => $(id).value = '');
    renderOrders(); showTab('ordersTab');
  });
}
function renderStaff() {
  $('staffList').innerHTML = db.staff.length ? db.staff.map(s => `<div class="staff-row"><div class="avatar">${esc(s.name.slice(0, 1))}</div><div><h3>${esc(s.name)} <span class="status-pill ${s.active ? 'active' : 'inactive'}">${s.active ? 'نشط' : 'موقوف'}</span></h3><p dir="ltr">@${esc(s.username)}</p><div class="staff-permissions">${permissionGroups.flatMap(g => [s.permissions.includes(g.manage) ? `${g.title}: تعديل` : s.permissions.includes(g.view) ? `${g.title}: مشاهدة` : null]).filter(Boolean).map(x => `<span>${esc(x)}</span>`).join('') || '<span>بدون صلاحيات</span>'}</div></div><button data-edit-staff="${s.id}">تعديل الحساب</button></div>`).join('') : '<p class="empty-list">ما فيش حسابات موظفين. اضغط «إضافة موظف» للبدء.</p>';
  $('staffList').querySelectorAll('[data-edit-staff]').forEach(b => b.onclick = () => openStaff(db.staff.find(s => s.id === b.dataset.editStaff)));
}
function settingsPreview(id, url) { $(id).innerHTML = url ? `<img src="${esc(url)}" alt="معاينة الصورة">` : '<span>ما فيش صورة مضافة</span>'; }
function addDeliveryRow(city = '', fee = '') {
  const row = document.createElement('div'); row.className = 'delivery-row';
  row.innerHTML = `<label>المدينة<input data-delivery-city maxlength="80" placeholder="مثال: طرابلس" value="${esc(city)}"></label><label>السعر بالدينار<input data-delivery-fee type="number" inputmode="numeric" min="0" max="10000" step="1" placeholder="0" value="${fee === '' ? '' : esc(fee)}"></label><button class="delivery-remove" type="button" aria-label="حذف المدينة">حذف</button>`;
  row.querySelector('.delivery-remove').onclick = () => { row.remove(); if (!$('deliveryRows').children.length) addDeliveryRow(); };
  row.querySelectorAll('input,button').forEach(x => x.disabled = !can('settings.manage'));
  $('deliveryRows').append(row);
}
function renderDeliveryRows(delivery = {}) {
  $('deliveryRows').innerHTML = '';
  const rows = Object.entries(delivery); (rows.length ? rows : [['', '']]).forEach(([city, fee]) => addDeliveryRow(city, fee));
}
function renderSettings() {
  $('storePhone').value = db.settings.phone || ''; $('policyText').value = db.settings.exchangePolicy || ''; $('privacyText').value = db.settings.privacyPolicy || '';
  $('telegramChatId').value = db.settings.telegramChatId || '';
  $('telegramStatus').textContent = db.telegramBotConfigured ? 'رمز بوت تيليجرام مضبوط على السيرفر.' : 'رمز بوت تيليجرام غير مضبوط على السيرفر بعد؛ لن تُرسل إشعارات حتى تتم إضافته.';
  renderDeliveryRows(db.settings.delivery || {});
  $('heroTitle').value = db.settings.heroTitle || ''; $('heroSubtitle').value = db.settings.heroSubtitle || '';
  heroImages = { heroImage: db.settings.heroImage || '', heroMobileImage: db.settings.heroMobileImage || '' };
  settingsPreview('heroImagePreview', heroImages.heroImage); settingsPreview('heroMobileImagePreview', heroImages.heroMobileImage);
  $('removeHeroImage').disabled = !heroImages.heroImage; $('removeHeroMobileImage').disabled = !heroImages.heroMobileImage;
  $('heroImageFile').value = ''; $('heroMobileImageFile').value = '';
}
function closeEditor() { $('editor').classList.add('hidden'); $('editorOverlay').classList.add('hidden'); document.body.style.overflow = ''; }
function openEditor(p) {
  $('productForm').reset(); clearError('productError'); $('productNotice').classList.add('hidden');
  $('productId').value = p?.id || ''; $('editorTitle').textContent = p ? 'تعديل المنتج' : 'إضافة منتج';
  $('productName').value = p?.name || ''; $('productCode').value = p?.code || ''; $('productPrice').value = p?.price || ''; $('productOldPrice').value = p?.oldPrice || '';
  const sizes = [...new Set([...Array.from({ length: 7 }, (_, i) => String(40 + i)), ...Object.keys(p?.sizes || {})])].sort((a, b) => Number(a) - Number(b));
  $('sizeInputs').innerHTML = sizes.map(size => `<label class="size-entry"><span>${size}</span><input data-size-qty="${size}" type="number" inputmode="numeric" min="0" max="100000" step="1" placeholder="—" value="${p?.sizes?.[size] || ''}" aria-label="كمية مقاس ${size}"></label>`).join('');
  $('productActive').checked = p ? p.active : true; imageUrls = [...(p?.images || [])]; renderImages();
  $('editor').classList.remove('hidden'); $('editorOverlay').classList.remove('hidden'); document.body.style.overflow = 'hidden';
}
function renderImages() { $('imagePreview').innerHTML = imageUrls.map((url, i) => `<button type="button" data-remove-img="${i}" aria-label="إزالة الصورة"><img src="${esc(url)}" alt="الصورة ${i + 1}">×</button>`).join(''); $('imagePreview').querySelectorAll('[data-remove-img]').forEach(b => b.onclick = () => { imageUrls.splice(Number(b.dataset.removeImg), 1); renderImages(); }); }
async function fileToData(file) {
  if (!file.type.startsWith('image/')) throw new Error('اختَر ملف صورة');
  const source = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة')); reader.readAsDataURL(file); });
  try {
    const img = await new Promise((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error('صيغة الصورة غير مدعومة على هذا الجهاز. جرّب JPG أو PNG أو WebP.')); element.src = source; });
    const ratio = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/jpeg', 0.9);
    if (data.length > 10_000_000) data = canvas.toDataURL('image/jpeg', 0.78);
    if (data.length > 10_000_000) throw new Error('الصورة كبيرة جدًا حتى بعد تجهيزها. جرّب صورة أصغر.');
    return data;
  } catch (error) { throw error; }
}
async function uploadImage(file, kind) { const data = await fileToData(file); const result = await api('/api/admin/upload', { method: 'POST', body: JSON.stringify({ data, kind }) }); return result.url; }
async function saveProduct(e) {
  e.preventDefault(); clearError('productError'); const button = e.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const sizes = {}; for (const field of $('sizeInputs').querySelectorAll('[data-size-qty]')) { const value = field.value.trim(); sizes[field.dataset.sizeQty] = value === '' ? 0 : Number(value); }
    if (Object.values(sizes).some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('اكتب كميات صحيحة للمقاسات');
    const files = [...$('productImages').files]; if (imageUrls.length + files.length > 6) throw new Error('الحد الأقصى 6 صور');
    for (const [i, file] of files.entries()) { $('productNotice').textContent = `جاري تجهيز ورفع الصورة ${i + 1} من ${files.length}...`; $('productNotice').classList.remove('hidden'); imageUrls.push(await uploadImage(file, 'product')); renderImages(); }
    $('productNotice').textContent = 'جاري حفظ المنتج...'; $('productNotice').classList.remove('hidden');
    const input = { name: $('productName').value, code: $('productCode').value, price: Number($('productPrice').value), oldPrice: Number($('productOldPrice').value || 0), sizes, images: imageUrls, active: $('productActive').checked };
    const id = $('productId').value; await api(id ? `/api/admin/products/${id}` : '/api/admin/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) }); closeEditor(); await load();
  } catch (err) { error('productError', err.message); } finally { $('productNotice').classList.add('hidden'); button.disabled = false; }
}
function closeStaff() { $('staffEditor').classList.add('hidden'); $('staffOverlay').classList.add('hidden'); document.body.style.overflow = ''; }
function openStaff(staff) {
  $('staffForm').reset(); clearError('staffError'); $('staffId').value = staff?.id || '';
  $('staffTitle').textContent = staff ? 'تعديل حساب الموظف' : 'إضافة موظف';
  $('staffName').value = staff?.name || ''; $('staffUsername').value = staff?.username || '';
  $('staffPasswordHint').textContent = staff ? 'اتركه فارغًا للإبقاء على الرمز الحالي. تغييره يُخرج الموظف من الجلسات الحالية.' : '12 حرفًا على الأقل';
  $('staffPassword').required = !staff; $('staffActive').checked = staff ? staff.active : true;
  $('permissionGrid').innerHTML = permissionGroups.map(g => `<div class="permission-group"><strong>${g.title}</strong><label><input type="checkbox" value="${g.view}" ${staff?.permissions.includes(g.view) ? 'checked' : ''}> مشاهدة</label><label><input type="checkbox" value="${g.manage}" ${staff?.permissions.includes(g.manage) ? 'checked' : ''}> تعديل</label></div>`).join('');
  $('staffEditor').classList.remove('hidden'); $('staffOverlay').classList.remove('hidden'); document.body.style.overflow = 'hidden';
}
async function saveStaff(e) {
  e.preventDefault(); clearError('staffError'); const button = e.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const input = { name: $('staffName').value, username: $('staffUsername').value, password: $('staffPassword').value, active: $('staffActive').checked, permissions: [...$('permissionGrid').querySelectorAll('input:checked')].map(x => x.value) };
    const id = $('staffId').value; await api(id ? `/api/admin/staff/${id}` : '/api/admin/staff', { method: id ? 'PUT' : 'POST', body: JSON.stringify(input) }); closeStaff(); await load();
  } catch (err) { error('staffError', err.message); } finally { button.disabled = false; }
}
async function saveSettings(e) {
  e.preventDefault(); clearError('settingsError'); const button = e.currentTarget.querySelector('button[type=submit]'); button.disabled = true;
  try {
    const delivery = {};
    for (const row of $('deliveryRows').querySelectorAll('.delivery-row')) {
      const city = row.querySelector('[data-delivery-city]').value.trim(), feeText = row.querySelector('[data-delivery-fee]').value.trim();
      if (!city && !feeText) continue;
      if (!city || feeText === '' || !Number.isSafeInteger(Number(feeText)) || Number(feeText) < 0) throw new Error('أكمل اسم المدينة وسعر التوصيل في كل صف');
      if (delivery[city] !== undefined) throw new Error(`المدينة «${city}» مضافة مرتين`);
      delivery[city] = Number(feeText);
    }
    for (const [inputId, setting] of [['heroImageFile', 'heroImage'], ['heroMobileImageFile', 'heroMobileImage']]) {
      const file = $(inputId).files[0]; if (!file) continue;
      $('settingsNotice').textContent = `جاري رفع ${setting === 'heroImage' ? 'صورة الواجهة' : 'صورة الهاتف'}...`; $('settingsNotice').classList.remove('hidden');
      heroImages[setting] = await uploadImage(file, 'homepage');
    }
    $('settingsNotice').textContent = 'جاري حفظ الإعدادات...'; $('settingsNotice').classList.remove('hidden');
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ phone: $('storePhone').value, exchangePolicy: $('policyText').value, privacyPolicy: $('privacyText').value, delivery, ...heroImages, heroTitle: $('heroTitle').value, heroSubtitle: $('heroSubtitle').value, telegramChatId: $('telegramChatId').value }) });
    await load(); $('settingsNotice').textContent = 'تم حفظ الإعدادات بنجاح.'; $('settingsNotice').classList.remove('hidden');
  } catch (err) { error('settingsError', err.message); $('settingsNotice').classList.add('hidden'); } finally { button.disabled = false; }
}

$('loginForm').onsubmit = async e => { e.preventDefault(); clearError('loginError'); window.AjeebLoader?.show(); try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) }); $('password').value = ''; await load(); window.AjeebLoader?.hide(); } catch (err) { window.AjeebLoader?.hide(); error('loginError', err.message); } };
$('logout').onclick = async () => { window.AjeebLoader?.show(); try { await api('/api/admin/logout', { method: 'POST' }); location.reload(); } catch (err) { window.AjeebLoader?.hide(); alert(err.message); } };
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('viewAllOrders').onclick = () => showTab('ordersTab');
$('overviewDate').onchange = renderStats;
$('previousDay').onclick = () => { $('overviewDate').value = dayShift($('overviewDate').value, -1); renderStats(); };
$('nextDay').onclick = () => { const next = dayShift($('overviewDate').value, 1), today = localDay(new Date().toISOString()); $('overviewDate').value = next > today ? today : next; renderStats(); };
$('todayDay').onclick = () => { $('overviewDate').value = localDay(new Date().toISOString()); renderStats(); };
$('newProduct').onclick = () => openEditor(); $('closeEditor').onclick = closeEditor; $('editorOverlay').onclick = closeEditor; $('productForm').onsubmit = saveProduct;
$('newStaff').onclick = () => openStaff(); $('closeStaff').onclick = closeStaff; $('staffOverlay').onclick = closeStaff; $('staffForm').onsubmit = saveStaff;
$('settingsForm').onsubmit = saveSettings;
$('addDelivery').onclick = () => addDeliveryRow();
for (const [inputId, previewId] of [['heroImageFile', 'heroImagePreview'], ['heroMobileImageFile', 'heroMobileImagePreview']]) {
  $(inputId).onchange = () => {
    if (previewUrls[inputId]) URL.revokeObjectURL(previewUrls[inputId]);
    const file = $(inputId).files[0]; if (!file) return;
    previewUrls[inputId] = URL.createObjectURL(file); settingsPreview(previewId, previewUrls[inputId]);
  };
}
for (const [buttonId, inputId, previewId, setting] of [['removeHeroImage', 'heroImageFile', 'heroImagePreview', 'heroImage'], ['removeHeroMobileImage', 'heroMobileImageFile', 'heroMobileImagePreview', 'heroMobileImage']]) {
  $(buttonId).onclick = () => { heroImages[setting] = ''; $(inputId).value = ''; settingsPreview(previewId, ''); $(buttonId).disabled = true; };
}
['orderSearch', 'statusFilter', 'dateFrom', 'dateTo'].forEach(id => $(id).oninput = renderOrders);
$('clearFilters').onclick = () => { ['orderSearch', 'statusFilter', 'dateFrom', 'dateTo'].forEach(id => $(id).value = ''); renderOrders(); };
$('customerSearch').oninput = renderCustomers; $('customerSort').onchange = renderCustomers;
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeEditor(); closeStaff(); } });
api('/api/admin/session').then(s => { if (s.loggedIn) load(); else if (!s.configured) error('loginError', 'كلمة مرور الإدارة لم تُجهّز على السيرفر بعد.'); }).catch(() => error('loginError', 'تعذر الاتصال بالسيرفر.'));

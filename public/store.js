const $ = (id) => document.getElementById(id);
const money = (n) => `${Number(n || 0).toLocaleString('ar-LY')} د.ل`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const demo = [
  { id: 'demo1', code: 'SH 2044', name: 'حذاء رياضي شبكي أسود', price: 135, oldPrice: 220, sizes: { 40: 2, 41: 2, 43: 1 }, images: [], demo: true },
  { id: 'demo2', code: 'SH 1989', name: 'حذاء كاجوال أبيض', price: 115, oldPrice: 190, sizes: { 37: 2, 38: 2, 39: 1, 40: 1 }, images: [], demo: true },
  { id: 'demo3', code: 'SH 1778', name: 'حذاء جري أسود', price: 145, oldPrice: 240, sizes: { 41: 1, 42: 2, 43: 1, 44: 1 }, images: [], demo: true }
];
let products = [], settings = { delivery: {}, phone: '', exchangePolicy: '' }, cart = [], selectedSize = '', activeSize = '', query = '';
const selectedCardSizes = new Map();
try { cart = JSON.parse(localStorage.getItem('ajeeb_cart') || '[]'); if (!Array.isArray(cart)) cart = []; } catch { cart = []; }
const saveCart = () => localStorage.setItem('ajeeb_cart', JSON.stringify(cart));
const findProduct = id => products.find(p => p.id === id);
const available = p => Object.entries(p.sizes).filter(([, q]) => q > 0).map(([s]) => s);
const photo = (p, cls = '') => p.images?.[0] ? `<img class="${cls}" src="${esc(p.images[0])}" alt="${esc(p.name)}">` : '<span class="placeholder" aria-hidden="true">عجيب</span>';
function filters() {
  const sizes = [...new Set(products.flatMap(available))].sort((a, b) => Number(a) - Number(b));
  $('sizeFilters').innerHTML = sizes.map(s => `<button data-size="${s}" class="${s === activeSize ? 'active' : ''}" aria-pressed="${s === activeSize}">${s}</button>`).join('');
  $('clearSizeFilter').classList.toggle('hidden', !activeSize);
  $('sizeFilters').querySelectorAll('button').forEach(b => b.onclick = () => { activeSize = activeSize === b.dataset.size ? '' : b.dataset.size; render(); });
}
function render() {
  filters(); const shown = products.filter(p => (!activeSize || available(p).includes(activeSize)) && (!query || `${p.name} ${p.code}`.toLowerCase().includes(query)));
  $('productCount').textContent = shown.length;
  $('previewNote').classList.toggle('hidden', !products.some(p => p.demo));
  $('empty').classList.toggle('hidden', shown.length > 0);
  $('products').innerHTML = shown.map(p => { const stock = Object.values(p.sizes).reduce((a, b) => a + b, 0); const discount = p.oldPrice > p.price ? Math.round((1 - p.price / p.oldPrice) * 100) : 0; const selected = selectedCardSizes.get(p.id);
    return `<article class="product-card"><button class="product-photo photo-open" data-view="${p.id}" aria-label="تفاصيل ${esc(p.name)}">${photo(p)}${discount ? `<span class="badge">خصم ${discount}%</span>` : ''}</button><div class="card-info"><div class="code-line"><span>${esc(p.code)}</span></div><h3>${esc(p.name)}</h3><div><span class="price">${money(p.price)}</span>${p.oldPrice ? `<span class="old">${money(p.oldPrice)}</span>` : ''}</div><div class="card-sizes" role="group" aria-label="مقاسات ${esc(p.name)}">${available(p).map(s => `<button type="button" data-card-size="${s}" data-product="${p.id}" class="${selected === s ? 'active' : ''}" aria-pressed="${selected === s}">${s}</button>`).join('')}</div><button class="button navy" data-add-card="${p.id}" ${stock ? '' : 'disabled'}>${stock ? p.demo ? 'منتج للمعاينة فقط' : selected ? 'إضافة إلى السلة' : 'اختار المقاس أولًا' : 'نفد المخزون'}</button></div></article>`;
  }).join('');
  $('products').querySelectorAll('[data-view]').forEach(b => b.onclick = () => showProduct(b.dataset.view));
  $('products').querySelectorAll('[data-card-size]').forEach(b => b.onclick = () => { selectedCardSizes.set(b.dataset.product, b.dataset.cardSize); render(); });
  $('products').querySelectorAll('[data-add-card]').forEach(b => b.onclick = () => { const p = findProduct(b.dataset.addCard); const size = selectedCardSizes.get(p.id); if (p.demo || !size) return showProduct(p.id); addToCart(p, size); });
  renderCart();
}
function addToCart(p, size) {
  if (p.demo || !size || !p.sizes[size]) return;
  const existing = cart.find(x => x.productId === p.id && x.size === size);
  if ((existing?.qty || 0) >= p.sizes[size]) { alert('الكمية المتوفرة لهذا المقاس وصلت للحد'); return; }
  if (existing) existing.qty++; else cart.push({ productId: p.id, size, qty: 1 });
  saveCart(); closeLayers(); renderCart(); showLayer('cartDrawer');
}
function showLayer(name) { $('overlay').classList.remove('hidden'); $(name).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeLayers() { for (const id of ['overlay', 'cartDrawer', 'productModal', 'checkoutModal']) $(id).classList.add('hidden'); document.body.style.overflow = ''; }
function showProduct(id) {
  const p = findProduct(id); if (!p) return; selectedSize = selectedCardSizes.get(id) || '';
  $('productDetail').innerHTML = `<div class="detail-grid"><div><div class="detail-main-image" id="detailMain">${p.images?.[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}">` : '<span aria-hidden="true">عجيب</span>'}</div><div class="thumbs">${(p.images || []).map((img, i) => `<button data-img="${i}" aria-label="الصورة ${i + 1}"><img src="${esc(img)}" alt=""></button>`).join('')}</div></div><div class="detail-info"><small>${esc(p.code)}</small><h2>${esc(p.name)}</h2><div><span class="price">${money(p.price)}</span>${p.oldPrice ? `<span class="old">${money(p.oldPrice)}</span>` : ''}</div><p>المقاسات المتوفرة:</p><div class="detail-sizes">${available(p).map(s => `<button class="size-pill" data-choice="${s}">${s}</button>`).join('')}</div><p>التوصيل داخل ليبيا • الدفع عند الاستلام</p><button id="addCart" class="button teal">${p.demo ? 'منتج للمعاينة فقط' : 'اختار المقاس أولًا'}</button></div></div>`;
  $('productDetail').querySelectorAll('[data-choice]').forEach(b => { b.classList.toggle('active', b.dataset.choice === selectedSize); b.onclick = () => { selectedSize = b.dataset.choice; selectedCardSizes.set(p.id, selectedSize); $('productDetail').querySelectorAll('[data-choice]').forEach(x => x.classList.toggle('active', x === b)); $('addCart').textContent = p.demo ? 'منتج للمعاينة فقط' : 'إضافة إلى السلة'; }; });
  if (selectedSize && !p.demo) $('addCart').textContent = 'إضافة إلى السلة';
  $('productDetail').querySelectorAll('[data-img]').forEach(b => b.onclick = () => { const img = p.images[Number(b.dataset.img)]; $('detailMain').innerHTML = `<img src="${esc(img)}" alt="${esc(p.name)}">`; });
  $('addCart').onclick = () => { if (p.demo) return; if (!selectedSize) return; addToCart(p, selectedSize); };
  showLayer('productModal');
}
function renderCart() {
  cart = cart.filter(x => { const p = findProduct(x.productId); return p && p.active !== false && p.sizes[x.size] > 0; }); saveCart();
  $('cartCount').textContent = cart.reduce((n, x) => n + x.qty, 0);
  const sum = cart.reduce((n, x) => n + findProduct(x.productId).price * x.qty, 0);
  $('cartSubtotal').textContent = money(sum);
  $('cartItems').innerHTML = cart.length ? cart.map((x, i) => { const p = findProduct(x.productId); return `<div class="cart-row"><div>${p.images?.[0] ? `<img src="${esc(p.images[0])}" alt="">` : '<span class="cart-placeholder">👟</span>'}</div><div><h3>${esc(p.name)}</h3><small>مقاس ${x.size} • ${money(p.price)}</small><div class="qty"><button data-action="minus" data-index="${i}" aria-label="تقليل الكمية">−</button><span>${x.qty}</span><button data-action="plus" data-index="${i}" aria-label="زيادة الكمية">+</button></div></div><button class="remove" data-action="remove" data-index="${i}" aria-label="حذف المنتج">حذف</button></div>`; }).join('') : '<p class="empty-cart">السلة فاضية توا.</p>';
  $('cartItems').querySelectorAll('[data-action]').forEach(b => b.onclick = () => { const i = Number(b.dataset.index), x = cart[i], p = findProduct(x.productId); if (b.dataset.action === 'remove') cart.splice(i, 1); else if (b.dataset.action === 'minus') { x.qty--; if (!x.qty) cart.splice(i, 1); } else if (x.qty < p.sizes[x.size]) x.qty++; saveCart(); renderCart(); });
  $('checkoutBtn').disabled = !cart.length;
}
function showCheckout() {
  if (!cart.length) return; closeLayers();
  const cities = Object.keys(settings.delivery || {}).sort((a, b) => a.localeCompare(b, 'ar'));
  $('city').innerHTML = `<option value="">اختر المدينة</option>${cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}`;
  $('orderError').classList.toggle('hidden', cities.length > 0);
  $('orderError').textContent = cities.length ? '' : 'الطلب غير متاح حتى يحدد المتجر أسعار التوصيل.';
  $('checkoutForm').querySelector('button[type=submit]').disabled = !cities.length;
  updateTotals(); showLayer('checkoutModal');
}
function updateTotals() { const sum = cart.reduce((n, x) => n + findProduct(x.productId).price * x.qty, 0); const fee = settings.delivery[$('city').value]; $('checkoutSubtotal').textContent = money(sum); $('deliveryFee').textContent = fee === undefined ? 'اختر المدينة' : money(fee); $('grandTotal').textContent = fee === undefined ? money(sum) : money(sum + fee); }
async function api(url, options = {}) { const res = await fetch(url, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...options }); const data = await res.json(); if (!res.ok) throw new Error(data.error || 'حدث خطأ'); return data; }
function startPresence() {
  let visitor = localStorage.getItem('ajeeb_visitor');
  if (!visitor) { visitor = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`; localStorage.setItem('ajeeb_visitor', visitor); }
  const ping = () => { if (!document.hidden) fetch('/api/presence', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visitor }) }).catch(() => {}); };
  ping(); setInterval(ping, 20000); document.addEventListener('visibilitychange', ping);
}
async function submitOrder(e) {
  e.preventDefault(); const button = e.currentTarget.querySelector('button[type=submit]'); button.disabled = true; $('orderError').classList.add('hidden');
  window.AjeebLoader?.show();
  try { const form = new FormData(e.currentTarget), customer = Object.fromEntries(form.entries()); const result = await api('/api/order', { method: 'POST', body: JSON.stringify({ customer, items: cart }) }); cart = []; saveCart(); sessionStorage.setItem('ajeeb_last_order', JSON.stringify(result)); location.assign('/success.html'); } catch (err) { window.AjeebLoader?.hide(); $('orderError').textContent = err.message; $('orderError').classList.remove('hidden'); button.disabled = false; }
}
async function init() {
  try {
    const data = await api('/api/catalog'); settings = data.settings; products = data.preview ? demo : data.products;
    const hero = settings.heroImage || settings.heroMobileImage;
    if (hero) {
      $('heroSection').classList.remove('hidden');
      $('heroImage').src = hero; $('heroMobileSource').srcset = settings.heroMobileImage || hero;
      const imageOnly = !settings.heroTitle && !settings.heroSubtitle;
      $('heroCopy').classList.toggle('hidden', imageOnly); $('heroSection').classList.toggle('image-only', imageOnly);
      $('heroTitle').textContent = settings.heroTitle || '';
      $('heroSubtitle').textContent = settings.heroSubtitle || '';
    }
    if (settings.phone) $('phone').textContent = `خدمة العملاء: ${settings.phone}`;
    if (settings.exchangePolicy) $('policy').textContent = settings.exchangePolicy;
    if (settings.privacyPolicy) { $('privacyBox').classList.remove('hidden'); $('privacyPolicy').textContent = settings.privacyPolicy; }
    render(); startPresence(); if (!products.length) $('empty').textContent = 'المنتجات الجديدة تُضاف قريبًا.';
  } catch { $('empty').textContent = 'تعذر تحميل المنتجات. حاول تحديث الصفحة.'; $('empty').classList.remove('hidden'); }
}
$('search').oninput = e => { query = e.target.value.trim().toLowerCase(); render(); };
$('clearSizeFilter').onclick = () => { activeSize = ''; render(); };
$('clearFilters').onclick = () => { activeSize = ''; query = ''; $('search').value = ''; render(); };
$('openCart').onclick = () => { renderCart(); showLayer('cartDrawer'); };
$('closeCart').onclick = closeLayers; $('closeProduct').onclick = closeLayers; $('closeCheckout').onclick = closeLayers; $('overlay').onclick = closeLayers;
$('checkoutBtn').onclick = showCheckout; $('city').onchange = updateTotals; $('checkoutForm').onsubmit = submitOrder;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLayers(); });
init();

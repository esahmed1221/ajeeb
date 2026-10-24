const arabicDigits = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9' };

export function normalizeInventoryQuestion(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[٠-٩]/g, digit => arabicDigits[digit])
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLocaleLowerCase('ar-LY')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inventoryProduct(product) {
  const sizes = Object.entries(product.sizes || {})
    .map(([size, stock]) => ({ size: String(size), stock: Number(stock || 0) }))
    .filter(entry => entry.stock > 0)
    .sort((left, right) => Number(left.size) - Number(right.size));
  return {
    id: product.id,
    name: product.name || 'منتج بدون اسم',
    code: product.code || '—',
    image: product.images?.[0] || '',
    active: product.active !== false,
    sizes,
    sizeCount: sizes.length,
    totalStock: sizes.reduce((sum, entry) => sum + entry.stock, 0)
  };
}

function requestedLimit(question) {
  const match = question.match(/(?:اول|اعلي|اكثر|اكبر)?\s*(\d{1,2})\s*(?:منتج|منتجات|صنف|اصناف|موديل|موديلات)/);
  return match ? Math.max(1, Math.min(25, Number(match[1]))) : 10;
}

function take(items, limit) { return items.slice(0, limit); }
function byStock(left, right) { return right.totalStock - left.totalStock || right.sizeCount - left.sizeCount || left.code.localeCompare(right.code); }
function bySizes(left, right) { return right.sizeCount - left.sizeCount || right.totalStock - left.totalStock || left.code.localeCompare(right.code); }
function response(intent, message, items = [], detail = '') { return { intent, message, items, detail }; }

function productsInStoreOrder(products) {
  return [...(Array.isArray(products) ? products : [])].sort((left, right) => Number(right.active) - Number(left.active) || Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || String(left.id).localeCompare(String(right.id)));
}

export function productStorePosition(products, productId, pageSize = 12) {
  const ordered = productsInStoreOrder(products), active = ordered.filter(product => product.active), index = active.findIndex(product => product.id === productId);
  if (index < 0) return { active: false, position: null, page: null, maximum: active.length };
  return { active: true, position: index + 1, page: Math.ceil((index + 1) / pageSize), maximum: active.length };
}

export function reorderProductForStore(products, productId, requestedPosition, pageSize = 12) {
  const ordered = productsInStoreOrder(products), activeCount = ordered.filter(product => product.active).length, sourceIndex = ordered.findIndex(product => product.id === productId);
  if (sourceIndex < 0 || !ordered[sourceIndex].active) return { products: ordered, changed: false, ...productStorePosition(ordered, productId, pageSize) };
  const position = Math.max(1, Math.min(activeCount, Math.trunc(Number(requestedPosition) || sourceIndex + 1))), targetIndex = position - 1;
  if (targetIndex !== sourceIndex) { const [moved] = ordered.splice(sourceIndex, 1); ordered.splice(targetIndex, 0, moved); }
  const updated = ordered.map((product, index) => ({ ...product, sortOrder: index + 1 }));
  return { products: updated, changed: targetIndex !== sourceIndex, ...productStorePosition(updated, productId, pageSize) };
}

export function answerInventoryQuestion(products, rawQuestion) {
  const question = normalizeInventoryQuestion(rawQuestion), inventory = (Array.isArray(products) ? products : []).map(inventoryProduct), limit = requestedLimit(question);
  if (!question) return response('help', 'اكتب سؤالك عن المخزون، أو اختَر واحدًا من الأسئلة الجاهزة.', [], 'أفهم المقاسات، الكميات، الأكواد، المنتجات النافدة والمنخفضة.');
  if (!inventory.length) return response('empty', 'لا توجد منتجات في قاعدة البيانات حاليًا.');

  const sizeMatch = question.match(/مقاس(?:ات)?\s*(?:رقم)?\s*(\d{2})/);
  const asksMoreSizes = /(?:اكثر|اعلي|اكبر).*مقاس|مقاس.*(?:اكثر|اعلي|اكبر)|تنوع.*مقاس/.test(question);
  const asksMoreStock = /(?:اكثر|اعلي|اكبر).*(?:مخزون|كمي)|(?:مخزون|كمي).*(?:اكثر|اعلي|اكبر)/.test(question);

  if (asksMoreSizes) {
    const items = take(inventory.filter(product => product.sizeCount > 0).sort(bySizes), limit);
    return response('most-sizes', 'هذه الموديلات فيها أكبر تنوّع من المقاسات المتوفرة حاليًا.', items, 'الترتيب حسب عدد المقاسات أولًا، ثم إجمالي القطع.');
  }

  if (sizeMatch) {
    const size = sizeMatch[1], items = take(inventory.filter(product => product.sizes.some(entry => entry.size === size)).sort((left, right) => (right.sizes.find(entry => entry.size === size)?.stock || 0) - (left.sizes.find(entry => entry.size === size)?.stock || 0) || byStock(left, right)), 25)
      .map(product => ({ ...product, focusSize: size, focusStock: product.sizes.find(entry => entry.size === size)?.stock || 0 }));
    return items.length
      ? response('size', `وجدت ${items.length} موديل متوفر في مقاس ${size}.`, items, `مرتبة حسب كمية مقاس ${size}.`)
      : response('size', `لا يوجد مخزون متوفر حاليًا في مقاس ${size}.`);
  }

  if (asksMoreStock) {
    const items = take(inventory.filter(product => product.totalStock > 0).sort(byStock), limit);
    return response('most-stock', 'هذه الموديلات لديها أعلى إجمالي كمية في المخزون.', items, 'الإجمالي محسوب من كل المقاسات المتوفرة لكل موديل.');
  }

  if (/(?:نافد|نفد|خلص|منتهي|صفر).*(?:مخزون|كمي)?|(?:مخزون|كمي).*(?:نافد|نفد|صفر)/.test(question)) {
    const items = take(inventory.filter(product => product.totalStock === 0).sort((left, right) => left.name.localeCompare(right.name, 'ar')), 25);
    return items.length ? response('out-of-stock', `يوجد ${items.length} موديل نافد ضمن النتائج المعروضة.`, items) : response('out-of-stock', 'ممتاز، لا يوجد موديل نافد بالكامل حاليًا.');
  }

  if (/(?:قليل|منخفض|قرب|شارف).*(?:مخزون|كمي)?|(?:مخزون|كمي).*(?:قليل|منخفض)/.test(question)) {
    const items = take(inventory.filter(product => product.totalStock > 0 && product.totalStock <= 5).sort((left, right) => left.totalStock - right.totalStock || left.sizeCount - right.sizeCount), 25);
    return items.length ? response('low-stock', `يوجد ${items.length} موديل مخزونه منخفض (5 قطع أو أقل).`, items) : response('low-stock', 'لا يوجد موديل بمخزون إجمالي 5 قطع أو أقل حاليًا.');
  }

  const matchedProduct = inventory
    .filter(product => normalizeInventoryQuestion(product.code).length >= 2 || normalizeInventoryQuestion(product.name).length >= 3)
    .sort((left, right) => String(right.code).length - String(left.code).length || right.name.length - left.name.length)
    .find(product => question.includes(normalizeInventoryQuestion(product.code)) || question.includes(normalizeInventoryQuestion(product.name)));
  if (matchedProduct) return response('product', `هذه تفاصيل مخزون ${matchedProduct.name}.`, [matchedProduct]);

  if (/(?:ملخص|اجمالي|عدد).*(?:مخزون|منتج|موديل|صنف)|(?:مخزون|منتجات).*(?:ملخص|اجمالي|عدد)|كم.*(?:منتج|قطعه)/.test(question)) {
    const stocked = inventory.filter(product => product.totalStock > 0), totalStock = inventory.reduce((sum, product) => sum + product.totalStock, 0), totalSizes = inventory.reduce((sum, product) => sum + product.sizeCount, 0);
    return response('summary', `عندك ${inventory.length} موديل، منها ${stocked.length} فيه مخزون، بإجمالي ${totalStock} قطعة موزعة على ${totalSizes} مقاس متوفر.`, take([...stocked].sort(byStock), 5), 'بالأسفل أعلى 5 موديلات من حيث الكمية.');
  }

  if (/(?:متوفر|موجود|في مخزون)/.test(question)) {
    const items = take(inventory.filter(product => product.totalStock > 0).sort(byStock), limit);
    return response('available', `هذه أعلى ${items.length} موديلات متوفرة في المخزون.`, items);
  }

  return response('help', 'لم أفهم السؤال بدقة. جرّب سؤالًا عن أكثر المقاسات، أعلى الكميات، مقاس محدد، كود منتج، المخزون المنخفض أو النافد.', [], 'مثال: «شن أكثر 10 موديلات من حيث عدد المقاسات؟»');
}

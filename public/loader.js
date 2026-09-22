(() => {
  const startedAt = performance.now();
  const loader = () => document.getElementById('siteLoader');
  const show = () => { const el = loader(); if (el) { el.classList.remove('loader-done'); el.setAttribute('aria-hidden', 'false'); } };
  const hide = () => { const el = loader(); if (el) { el.classList.add('loader-done'); el.setAttribute('aria-hidden', 'true'); } };
  window.AjeebLoader = { show, hide };

  const finishInitialLoad = () => window.setTimeout(hide, Math.max(0, 650 - (performance.now() - startedAt)));
  if (document.readyState === 'complete') finishInitialLoad();
  else window.addEventListener('load', finishInitialLoad, { once: true });

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || link.target === '_blank' || link.hasAttribute('download')) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin || url.protocol === 'tel:' || url.protocol === 'mailto:') return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    show();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) hide(); });
})();

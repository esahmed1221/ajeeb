let activePixelId = '';
let pageViewSent = false;

const normalizePixelId = value => {
  const id = String(value || '').trim();
  return /^\d{5,30}$/.test(id) ? id : '';
};

function installMetaPixelQueue() {
  if (window.fbq) return;
  const fbq = function () {
    if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments);
    else fbq.queue.push(arguments);
  };
  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;
  if (!document.getElementById('meta-pixel-script')) {
    const script = document.createElement('script');
    script.id = 'meta-pixel-script';
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    script.referrerPolicy = 'strict-origin-when-cross-origin';
    document.head.appendChild(script);
  }
}

export function initMetaPixel(pixelId) {
  const id = normalizePixelId(pixelId);
  if (!id) return false;
  installMetaPixelQueue();
  if (activePixelId !== id) {
    window.fbq('init', id);
    activePixelId = id;
    pageViewSent = false;
  }
  if (!pageViewSent) {
    window.fbq('track', 'PageView');
    pageViewSent = true;
  }
  return true;
}

export function trackMetaEvent(name, parameters = {}, options) {
  if (!activePixelId || !window.fbq) return false;
  if (options) window.fbq('track', name, parameters, options);
  else window.fbq('track', name, parameters);
  return true;
}

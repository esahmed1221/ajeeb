import assert from 'node:assert/strict';
import { initMetaPixel, trackMetaEvent } from '../public/meta-pixel.js';

const scripts = [];
global.window = {};
global.document = {
  getElementById: () => null,
  createElement: () => ({}),
  head: { appendChild: script => scripts.push(script) }
};

assert.equal(initMetaPixel('not-a-pixel'), false);
assert.equal(initMetaPixel('123456789012345'), true);
assert.equal(scripts.length, 1);
assert.equal(scripts[0].src, 'https://connect.facebook.net/en_US/fbevents.js');
assert.deepEqual(Array.from(window.fbq.queue[0]), ['init', '123456789012345']);
assert.deepEqual(Array.from(window.fbq.queue[1]), ['track', 'PageView']);
assert.equal(initMetaPixel('123456789012345'), true);
assert.equal(window.fbq.queue.length, 2);

const purchase = { value: 130, currency: 'LYD', content_ids: ['SH 1778'] };
assert.equal(trackMetaEvent('Purchase', purchase, { eventID: 'ajeeb-order-5000' }), true);
assert.deepEqual(Array.from(window.fbq.queue[2]), ['track', 'Purchase', purchase, { eventID: 'ajeeb-order-5000' }]);
console.log('Meta Pixel smoke test passed');

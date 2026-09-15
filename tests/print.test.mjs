import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLayout, renderSheet, setJpegDpi, canvasToJpeg } from '../src/lib/print.js';

test('eight 35 × 45 mm photos fit a 150 × 100 mm sheet at their real size', () => {
  const layout = calculateLayout();
  assert.equal(layout.valid, true);
  assert.equal(layout.capacity, 8);
  assert.equal(layout.cols, 4);
  assert.equal(layout.rows, 2);
  assert.equal(layout.rotated, false);
  assert.equal(layout.placements.length, 8);
  assert.deepEqual(layout.placements[0], { x: 2, y: 4, width: 35, height: 45, rotate: false });
  assert.deepEqual(layout.placements[7], { x: 113, y: 51, width: 35, height: 45, rotate: false });
});

test('impossible requests report capacity without silently shrinking or dropping copies', () => {
  const layout = calculateLayout({ photoWidth: 51, photoHeight: 51 });
  assert.equal(layout.valid, false);
  assert.equal(layout.capacity, 2);
  assert.equal(layout.placements.length, 0);
  assert.match(layout.error, /Only 2 copies fit/);
  const oversized = calculateLayout({ photoWidth: 200, photoHeight: 200 });
  assert.equal(oversized.capacity, 0);
  assert.match(oversized.error, /does not fit/);
});

test('rotation is used when it increases capacity', () => {
  const layout = calculateLayout({ photoWidth: 45, photoHeight: 35 });
  assert.equal(layout.valid, true);
  assert.equal(layout.rotated, true);
  assert.equal(layout.capacity, 8);
  assert.ok(layout.placements.every((p) => p.rotate && p.width === 35 && p.height === 45));
});

test('square photos stay upright on equal capacity', () => {
  const layout = calculateLayout({ photoWidth: 30, photoHeight: 30 });
  assert.equal(layout.rotated, false);
  assert.equal(layout.capacity, 12);
  assert.equal(layout.placements.length, 8);
});

test('a partially filled last row is centered and the complete group is vertically centered', () => {
  const layout = calculateLayout({ copies: 6 });
  const [first, last] = layout.placements.slice(4);
  assert.equal(first.x, 39);
  assert.equal(last.x + last.width, 111);
  assert.equal(first.x, layout.paperWidth - last.x - last.width);
  assert.equal(layout.placements[0].y, layout.paperHeight - last.y - last.height);
});

test('one photo remains centered', () => {
  const layout = calculateLayout({ copies: 1 });
  assert.equal(layout.cols, 1);
  assert.equal(layout.rows, 1);
  assert.equal(layout.placements[0].x, 57.5);
  assert.equal(layout.placements[0].y, 27.5);
});

test('valid layouts preserve margins and do not overlap over diverse dimensions', () => {
  for (const [photoWidth, photoHeight, paperWidth, paperHeight, gap, margin] of [
    [35, 45, 150, 100, 2, 2], [45, 35, 150, 100, 1.3, 3],
    [50.8, 50.8, 152.4, 101.6, 0, 0], [30, 40, 100, 150, 0.5, 3.7],
    [12, 17, 210, 297, 3.2, 10],
  ]) {
    for (let copies = 1; copies <= 100; copies++) {
      const layout = calculateLayout({ photoWidth, photoHeight, paperWidth, paperHeight, copies, gap, margin });
      if (!layout.valid) continue;
      assert.equal(layout.placements.length, copies);
      for (const [i, p] of layout.placements.entries()) {
        assert.ok(p.x >= margin - 1e-8 && p.y >= margin - 1e-8);
        assert.ok(p.x + p.width <= paperWidth - margin + 1e-8);
        assert.ok(p.y + p.height <= paperHeight - margin + 1e-8);
        for (const q of layout.placements.slice(i + 1)) {
          assert.ok(p.x + p.width <= q.x + 1e-8 || q.x + q.width <= p.x + 1e-8
            || p.y + p.height <= q.y + 1e-8 || q.y + q.height <= p.y + 1e-8);
        }
      }
    }
  }
});

test('invalid dimensions and input values return clear errors', () => {
  for (const options of [
    { photoWidth: NaN }, { photoHeight: Infinity }, { photoWidth: -1 },
    { paperWidth: 0 }, { paperHeight: 1001 }, { copies: 0 }, { copies: 101 },
    { copies: 1.5 }, { gap: -1 }, { gap: NaN }, { margin: Infinity },
    { photoWidth: '35' },
  ]) {
    const layout = calculateLayout(options);
    assert.equal(layout.valid, false);
    assert.ok(layout.error.length);
    assert.equal(layout.placements.length, 0);
  }
});

test('fractional dimensions fit exactly without a rounding-induced lost column', () => {
  const layout = calculateLayout({ photoWidth: 50.8, photoHeight: 50.8, paperWidth: 152.4, paperHeight: 101.6, gap: 0, margin: 0, copies: 6 });
  assert.equal(layout.valid, true);
  assert.equal(layout.capacity, 6);
});

const existingJfif = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0,
  1, 1, 1, 0, 96, 0, 96, 0, 0, 0xff, 0xd9,
]);

test('JPEG density changes both axes to 300 DPI and preserves all other bytes', () => {
  const original = new Uint8Array(existingJfif);
  const encoded = setJpegDpi(original, 300);
  assert.equal(encoded.length, original.length);
  assert.equal(encoded[13], 1);
  assert.equal((encoded[14] << 8) | encoded[15], 300);
  assert.equal((encoded[16] << 8) | encoded[17], 300);
  assert.deepEqual(original, existingJfif);
  for (let i = 0; i < encoded.length; i++) {
    if (i < 13 || i > 17) assert.equal(encoded[i], original[i]);
  }
});

test('JPEG without JFIF gains one without changing the compressed image bytes', () => {
  const source = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 10, 20, 0xff, 0xda, 0, 2, 17, 22, 0xff, 0xd9]);
  const encoded = setJpegDpi(source, 600);
  assert.equal(encoded.length, source.length + 18);
  assert.deepEqual(encoded.subarray(20), source.subarray(2));
  assert.equal((encoded[14] << 8) | encoded[15], 600);
  assert.equal((encoded[16] << 8) | encoded[17], 600);
  assert.deepEqual(setJpegDpi(encoded, 300).subarray(20), source.subarray(2));
});

test('density rejects non-JPEG bytes and invalid density', () => {
  assert.throws(() => setJpegDpi(new Uint8Array([1, 2])), /JPEG/);
  for (const dpi of [0, 65536, Infinity, 300.5]) {
    assert.throws(() => setJpegDpi(existingJfif, dpi), /DPI/);
  }
});

test('JPEG export provides an image/jpeg blob containing correct print density', async () => {
  const canvas = { toBlob: (callback, format, quality) => {
    assert.equal(format, 'image/jpeg');
    assert.ok(quality >= 0.95);
    callback(new Blob([existingJfif], { type: 'image/jpeg' }));
  } };
  const blob = await canvasToJpeg(canvas, 300);
  assert.equal(blob.type, 'image/jpeg');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal((bytes[14] << 8) | bytes[15], 300);
  await assert.rejects(canvasToJpeg({ toBlob: (callback) => callback(null) }), /Could not export/);
});

test('sheet uses exact physical mapping at rounded 300-DPI page resolution and preserves aspect ratio', () => {
  const calls = [];
  const context = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]), set: () => true });
  const canvas = { width: 0, height: 0, getContext: () => context };
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => canvas };
  try {
    renderSheet({ width: 700, height: 900 }, calculateLayout(), { cutMarks: false });
    assert.equal(canvas.width, 1772);
    assert.equal(canvas.height, 1181);
    assert.deepEqual(calls.find(([name]) => name === 'setTransform'), ['setTransform', 1772 / 150, 0, 0, 1181 / 100, 0, 0]);
    const draws = calls.filter(([name]) => name === 'drawImage');
    assert.equal(draws.length, 8);
    assert.deepEqual(draws[0].slice(2), [0, 0, 700, 900, -17.5, -22.5, 35, 45]);
    calls.length = 0;
    renderSheet({ width: 1200, height: 900 }, calculateLayout({ photoWidth: 45, photoHeight: 35 }), { cutMarks: false });
    assert.equal(calls.filter(([name]) => name === 'rotate').length, 8);
    const rotatedDraw = calls.find(([name]) => name === 'drawImage');
    const sourceWidth = rotatedDraw[4];
    const sourceHeight = rotatedDraw[5];
    assert.ok(Math.abs(sourceWidth / sourceHeight - 45 / 35) < 1e-10);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});

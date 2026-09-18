import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAppServer, readConfig } from '../server/index.mjs';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0xff, 0xd9]);
const uploadHeaders = {
  'content-type': 'image/jpeg', 'x-filename': 'my-passport.jpg',
  'x-photo-width': '35', 'x-photo-height': '45',
};

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function fixture(t, extraEnv = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'passport-printer-test-'));
  const distPath = path.join(directory, 'dist');
  await mkdir(path.join(distPath, 'assets'), { recursive: true });
  await mkdir(path.join(distPath, '.well-known'), { recursive: true });
  await writeFile(path.join(distPath, 'index.html'), '<!doctype html><title>Passport Printer</title>');
  await writeFile(path.join(distPath, 'manifest.webmanifest'), '{"name":"Passport Photo Printer"}');
  await writeFile(path.join(distPath, '.well-known', 'security.txt'), 'Contact: https://example.test/security');
  await writeFile(path.join(distPath, 'assets', 'app-test.js'), 'console.log("asset");');
  await writeFile(path.join(directory, 'secret.txt'), 'private fixture data');
  const uploads = [];
  const tagRequests = [];
  const tags = new Map();
  const taggedAssets = new Map();
  const tagResponses = new Map();
  let upstreamStatus = 201;
  let upstreamResult = { id: 'f14b1a84-17c2-41d9-8e86-0414d6080a9f', status: 'created' };
  let upstreamHeaders = {};
  let shouldHang = false;
  const upstream = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (request.url === '/api/tags' || request.url === '/api/tags/assets') {
      const json = JSON.parse(body.toString());
      tagRequests.push({ method: request.method, url: request.url, headers: request.headers, body: json });
      const stage = request.url === '/api/tags' ? 'upsert' : 'assets';
      const override = tagResponses.get(stage);
      if (override) {
        if (override.hang) return;
        response.writeHead(override.status, { 'Content-Type': 'application/json', ...override.headers });
        response.end(JSON.stringify(override.body));
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      if (stage === 'upsert') {
        const upserted = json.tags.map((value) => {
          if (!tags.has(value)) tags.set(value, { id: `00000000-0000-4000-8000-${String(tags.size + 1).padStart(12, '0')}`, name: value, value });
          return tags.get(value);
        });
        response.end(JSON.stringify(upserted.reverse()));
        return;
      }
      let count = 0;
      for (const assetId of json.assetIds) {
        const assigned = taggedAssets.get(assetId) || new Set();
        for (const tagId of json.tagIds) {
          if (!assigned.has(tagId)) { assigned.add(tagId); count++; }
        }
        taggedAssets.set(assetId, assigned);
      }
      response.end(JSON.stringify({ count }));
      return;
    }
    uploads.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (shouldHang) return;
    response.writeHead(upstreamStatus, { 'Content-Type': 'application/json', ...upstreamHeaders });
    response.end(JSON.stringify(upstreamResult));
  });
  const upstreamUrl = await listen(upstream);
  const config = readConfig({ IMMICH_URL: upstreamUrl, IMMICH_API_KEY: 'private-test-key', MAX_UPLOAD_BYTES: '1024', ...extraEnv });
  const server = createAppServer({ config, distPath });
  const base = await listen(server);
  t.after(async () => {
    server.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => upstream.close(resolve))]);
    await rm(directory, { recursive: true, force: true });
  });
  return {
    base, config, directory, uploads, tagRequests, tags, taggedAssets,
    setUpstream(status, result, headers = {}) { upstreamStatus = status; upstreamResult = result; upstreamHeaders = headers; },
    setTagResponse(stage, status, body, headers = {}) { tagResponses.set(stage, { status, body, headers }); },
    hangTags(stage = 'upsert') { tagResponses.set(stage, { hang: true }); },
    hang() { shouldHang = true; },
    upload(body = jpeg, headers = {}) {
      return fetch(`${base}/api/immich/upload`, { method: 'POST', headers: { ...uploadHeaders, ...headers }, body });
    },
  };
}

function rawRequest(base, requestPath, { method = 'GET', headers = {}, chunks = [] } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(base);
    const request = httpRequest({ hostname: target.hostname, port: target.port, path: requestPath, method, headers }, (response) => {
      const body = [];
      response.on('data', (chunk) => body.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(body).toString() }));
    });
    request.on('error', reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

test('health and browser config do not expose the API key or private Immich URL', async (t) => {
  const app = await fixture(t);
  assert.deepEqual(await (await fetch(`${app.base}/api/health`)).json(), { status: 'ok' });
  const response = await fetch(`${app.base}/api/config`);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { immichConfigured: true, maxUploadBytes: 1024 });
});

test('forwards a JPEG as Immich multipart data, with a deterministic duplicate identifier', async (t) => {
  const app = await fixture(t, { IMMICH_PUBLIC_URL: 'https://photos.example.test/' });
  const response = await app.upload(jpeg, { origin: app.base, 'x-filename': encodeURIComponent('../my: portrait.jpg') });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'created');
  assert.deepEqual(result.tags, ['pass photo', '35x45 mm']);
  assert.equal(result.tagsApplied, true);
  assert.equal(result.url, `https://photos.example.test/photos/${result.id}`);
  assert.equal(app.uploads.length, 1);
  const forwarded = app.uploads[0];
  assert.equal(forwarded.url, '/api/assets');
  assert.equal(forwarded.method, 'POST');
  assert.equal(forwarded.headers['x-api-key'], 'private-test-key');
  const multipart = await new Response(forwarded.body, { headers: { 'Content-Type': forwarded.headers['content-type'] } }).formData();
  assert.equal(multipart.get('deviceId'), 'passport-photo-printer');
  assert.match(multipart.get('deviceAssetId'), /^passport-print-[a-f0-9]{64}$/);
  assert.equal(multipart.get('assetData').name, '_my_ portrait.jpg');
  assert.equal(multipart.get('assetData').type, 'image/jpeg');
  assert.deepEqual(Buffer.from(await multipart.get('assetData').arrayBuffer()), jpeg);
  assert.ok(!Number.isNaN(Date.parse(multipart.get('fileCreatedAt'))));
  assert.equal(multipart.get('fileCreatedAt'), multipart.get('fileModifiedAt'));
  app.setUpstream(200, { id: result.id, status: 'duplicate' });
  assert.equal((await (await app.upload()).json()).status, 'duplicate');
  const repeated = await new Response(app.uploads[1].body, { headers: { 'Content-Type': app.uploads[1].headers['content-type'] } }).formData();
  assert.equal(repeated.get('deviceAssetId'), multipart.get('deviceAssetId'));
});

test('supports root or /api server URLs and file-based secrets', async (t) => {
  const app = await fixture(t);
  const keyPath = path.join(app.directory, 'api-key');
  await writeFile(keyPath, 'file-based-secret\n');
  const config = readConfig({ IMMICH_URL: 'http://immich:2283/api/', IMMICH_API_KEY_FILE: keyPath });
  assert.equal(config.immichEndpoint, 'http://immich:2283/api/assets');
  assert.equal(config.apiKey, 'file-based-secret');
  assert.equal(config.immichConfigured, true);
  assert.throws(() => readConfig({ IMMICH_API_KEY: 'x', IMMICH_API_KEY_FILE: keyPath }), /either/);
  assert.throws(() => readConfig({ IMMICH_URL: 'https://user:password@example.test' }), /without credentials/);
  assert.throws(() => readConfig({ PUBLIC_ORIGIN: 'https://example.test/path' }), /only an origin/);
  assert.throws(() => readConfig({ MAX_UPLOAD_BYTES: '-1' }), /positive integer/);
});

test('rejects cross-site uploads, a mismatched Origin, and requests without a custom header', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.upload(jpeg, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await app.upload(jpeg, { origin: 'https://other.example.test' })).status, 403);
  const missingHeader = await fetch(`${app.base}/api/immich/upload`, { method: 'POST', body: jpeg, headers: { 'Content-Type': 'image/jpeg' } });
  assert.equal(missingHeader.status, 400);
  const preflight = await fetch(`${app.base}/api/immich/upload`, { method: 'OPTIONS', headers: { origin: 'https://other.example.test' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  assert.equal(app.uploads.length, 0);
});

test('supports an explicitly configured external app Origin behind a TLS reverse proxy', async (t) => {
  const app = await fixture(t, { PUBLIC_ORIGIN: 'https://printer.example.test' });
  assert.equal((await app.upload(jpeg, { origin: 'https://printer.example.test' })).status, 200);
  assert.equal((await app.upload(jpeg, { origin: app.base })).status, 403);
});

test('rejects invalid images and oversized fixed-length or chunked bodies', async (t) => {
  const app = await fixture(t);
  assert.equal((await app.upload(jpeg, { 'content-type': 'image/png' })).status, 415);
  assert.equal((await app.upload(Buffer.from('not a jpeg'))).status, 400);
  assert.equal((await app.upload(Buffer.alloc(1025))).status, 413);
  const chunked = await rawRequest(app.base, '/api/immich/upload', {
    method: 'POST', headers: uploadHeaders, chunks: [jpeg, Buffer.alloc(1025)],
  });
  assert.equal(chunked.status, 413);
  assert.equal(app.uploads.length, 0);
});

test('explains Immich configuration failures without forwarding private upstream errors', async (t) => {
  const app = await fixture(t);
  app.setUpstream(403, { message: 'bad private-test-key at internal.private.host' });
  const response = await app.upload();
  assert.equal(response.status, 502);
  const message = (await response.json()).error;
  assert.match(message, /asset\.upload/);
  assert.doesNotMatch(message, /private-test-key|internal\.private\.host/);
  app.setUpstream(413, {});
  assert.equal((await app.upload()).status, 413);
  app.setUpstream(500, {});
  assert.match((await (await app.upload()).json()).error, /HTTP 500/);
});

test('never follows upstream redirects with the API key', async (t) => {
  const app = await fixture(t);
  app.setUpstream(307, {}, { Location: '/redirected' });
  const response = await app.upload();
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /redirected/);
  assert.equal(app.uploads.length, 1);
});

test('times out an unresponsive Immich server', async (t) => {
  const app = await fixture(t, { IMMICH_TIMEOUT_MS: '30' });
  app.hang();
  const response = await app.upload();
  assert.equal(response.status, 504);
});

test('the app works with Immich disabled and reports that saves are unavailable', async (t) => {
  const app = await fixture(t, { IMMICH_API_KEY: '' });
  assert.equal((await (await fetch(`${app.base}/api/config`)).json()).immichConfigured, false);
  assert.equal((await app.upload()).status, 503);
});

test('serves build assets with MIME/cache headers and limits SPA fallback to HTML routes', async (t) => {
  const app = await fixture(t);
  const index = await fetch(app.base);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(index.headers.get('permissions-policy'), 'camera=(self), geolocation=(), microphone=(), payment=(), usb=()');
  assert.equal(index.headers.get('cross-origin-opener-policy'), 'same-origin');
  const manifest = await fetch(`${app.base}/manifest.webmanifest`);
  assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);
  assert.match(manifest.headers.get('cache-control'), /no-cache/);
  const securityPolicy = await fetch(`${app.base}/.well-known/security.txt`);
  assert.match(securityPolicy.headers.get('content-type'), /text\/plain/);
  assert.match(await securityPolicy.text(), /Contact:/);
  assert.match(await index.text(), /Passport Printer/);
  const asset = await fetch(`${app.base}/assets/app-test.js`);
  assert.match(asset.headers.get('content-type'), /javascript/);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(`${app.base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${app.base}/other-route`, { headers: { Accept: 'text/html' } })).status, 200);
  assert.equal((await fetch(`${app.base}/other-route`)).status, 404);
  assert.equal((await fetch(`${app.base}/api/missing`, { headers: { Accept: 'text/html' } })).status, 404);
  assert.equal((await fetch(app.base, { method: 'HEAD' })).status, 200);
  assert.equal((await fetch(app.base, { method: 'DELETE' })).status, 405);
});

test('rejects raw, encoded, and Windows-style traversal without exposing files', async (t) => {
  const app = await fixture(t);
  for (const requestPath of ['/../secret.txt', '/%2e%2e/secret.txt', '/%2e%2e%5csecret.txt', '/.env', '/%00', '/%invalid']) {
    const response = await rawRequest(app.base, requestPath, { headers: { Accept: 'text/html' } });
    assert.ok([400, 404].includes(response.status), `${requestPath}: ${response.status}`);
    assert.doesNotMatch(response.body, /private fixture data/);
  }
});

test('uses canonical selected-photo format tags on sheets and single-photo saves', async (t) => {
  const app = await fixture(t);
  const saved = await (await app.upload(jpeg, { 'x-photo-width': '050.800', 'x-photo-height': '50.80', 'x-filename': 'print-sheet.jpg' })).json();
  assert.deepEqual(saved.tags, ['pass photo', '50.8x50.8 mm']);
  assert.equal(saved.tagsApplied, true);
  assert.deepEqual(app.tagRequests[0].body, { tags: ['pass photo', '50.8x50.8 mm'] });
  assert.equal(app.tagRequests[0].method, 'PUT');
  assert.equal(app.tagRequests[0].url, '/api/tags');
  assert.equal(app.tagRequests[0].headers['x-api-key'], 'private-test-key');
  assert.deepEqual(app.tagRequests[1].body, {
    tagIds: [app.tags.get('pass photo').id, app.tags.get('50.8x50.8 mm').id], assetIds: [saved.id],
  });
  const single = await (await app.upload(jpeg, { 'x-photo-width': '37.125', 'x-photo-height': '48', 'x-filename': 'cropped-photo.jpg' })).json();
  assert.deepEqual(single.tags, ['pass photo', '37.125x48 mm']);
  assert.equal(single.tagsApplied, true);
});

test('requires valid photo dimensions before making any upload or tag request', async (t) => {
  const app = await fixture(t);
  for (const value of ['', 'NaN', 'Infinity', '-35', '0', '0.5', '1000.1', '1001', '35x45', '3.5e1', '35/45', '35,45']) {
    const response = await app.upload(jpeg, { 'x-photo-width': value });
    assert.equal(response.status, 400, `width ${JSON.stringify(value)}`);
  }
  const response = await fetch(`${app.base}/api/immich/upload`, {
    method: 'POST', body: jpeg, headers: { 'Content-Type': 'image/jpeg', 'X-Filename': 'missing-dimensions.jpg' },
  });
  assert.equal(response.status, 400);
  assert.equal(app.uploads.length, 0);
  assert.equal(app.tagRequests.length, 0);
});

test('reuses existing tags and idempotently tags duplicate and concurrent saves', async (t) => {
  const app = await fixture(t);
  const existing = { id: 'd2735e55-045d-4a45-a217-9f2dc6741811', name: 'pass photo', value: 'pass photo', color: '#112233' };
  app.tags.set('pass photo', existing);
  const first = await (await app.upload()).json();
  assert.equal(app.tags.get('pass photo'), existing);
  app.setUpstream(200, { id: first.id, status: 'duplicate' });
  const duplicates = await Promise.all([app.upload(), app.upload(), app.upload()]);
  for (const response of duplicates) {
    const result = await response.json();
    assert.equal(result.status, 'duplicate');
    assert.equal(result.tagsApplied, true);
    assert.deepEqual(result.tags, ['pass photo', '35x45 mm']);
  }
  assert.equal(app.tags.size, 2);
  assert.equal(app.taggedAssets.get(first.id).size, 2);
  assert.equal(app.tagRequests.filter((request) => request.url === '/api/tags').length, 4);
});

test('retains successful upload results with a safe warning when tag creation fails', async (t) => {
  const app = await fixture(t, { IMMICH_PUBLIC_URL: 'https://photos.example.test' });
  app.setTagResponse('upsert', 403, { message: 'private-test-key at private.immich.internal' });
  const response = await app.upload();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'created');
  assert.ok(result.id);
  assert.equal(result.url, `https://photos.example.test/photos/${result.id}`);
  assert.deepEqual(result.tags, ['pass photo', '35x45 mm']);
  assert.equal(result.tagsApplied, false);
  assert.match(result.warning, /photo is saved.*tag\.create and tag\.asset/);
  assert.doesNotMatch(JSON.stringify(result), /private-test-key|private\.immich\.internal/);
  assert.equal(app.tagRequests.length, 1);
});

test('retains duplicate results when tag attachment fails and never follows tagging redirects', async (t) => {
  const app = await fixture(t);
  app.setUpstream(200, { id: 'f14b1a84-17c2-41d9-8e86-0414d6080a9f', status: 'duplicate' });
  app.setTagResponse('assets', 307, {}, { Location: 'https://untrusted.example.test/steal-key' });
  const response = await app.upload();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'duplicate');
  assert.equal(result.tagsApplied, false);
  assert.match(result.warning, /photo is saved/);
  assert.equal(app.tagRequests.length, 2);
  assert.equal(app.uploads.length, 1);
});

test('reports incomplete or malformed tag responses as partial success', async (t) => {
  const app = await fixture(t);
  app.setTagResponse('upsert', 200, [{ id: 'one-tag', value: 'pass photo' }]);
  assert.equal((await (await app.upload()).json()).tagsApplied, false);
  assert.equal(app.tagRequests.length, 1);
  app.setTagResponse('upsert', 200, [{ id: 'one-tag', value: 'pass photo' }, { id: 'two-tag', value: '35x45 mm' }]);
  app.setTagResponse('assets', 200, { unexpected: true });
  assert.equal((await (await app.upload()).json()).tagsApplied, false);
});

test('a timeout after successful upload keeps the saved image and reports unconfirmed tags', async (t) => {
  const app = await fixture(t, { IMMICH_TIMEOUT_MS: '100' });
  app.hangTags();
  const response = await app.upload();
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'created');
  assert.equal(result.tagsApplied, false);
  assert.match(result.warning, /photo is saved.*too long/);
});

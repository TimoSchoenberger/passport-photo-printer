// Local integration fixture: the production server talks to a fake Immich.
import { createServer } from 'node:http';
import { createAppServer, readConfig } from '../server/index.mjs';

let latestUpload;
let failure = false;
let tagFailure = false;
const seen = new Set();
const tags = new Map();
const taggedAssets = new Map();
const mock = createServer(async (request, response) => {
  if (request.url === '/test/upload') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(latestUpload || {}));
    return;
  }
  if (request.url === '/test/fail') { failure = true; response.end('ok'); return; }
  if (request.url === '/test/fail-tags') { tagFailure = true; response.end('ok'); return; }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const data = Buffer.concat(chunks);
  if (request.url === '/api/tags' && request.method === 'PUT') {
    const requested = JSON.parse(data.toString()).tags;
    if (latestUpload) latestUpload.requestedTags = requested;
    if (tagFailure) { tagFailure = false; response.writeHead(403); response.end('tag-test-secret-never-expose'); return; }
    const values = requested.map((value) => {
      if (!tags.has(value)) tags.set(value, { id: `00000000-0000-4000-8000-${String(tags.size + 1).padStart(12, '0')}`, name: value, value });
      return tags.get(value);
    });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(values));
    return;
  }
  if (request.url === '/api/tags/assets' && request.method === 'PUT') {
    const { tagIds, assetIds } = JSON.parse(data.toString());
    let count = 0;
    for (const assetId of assetIds) {
      const assigned = taggedAssets.get(assetId) || new Set();
      for (const tagId of tagIds) {
        if (!assigned.has(tagId)) { assigned.add(tagId); count++; }
      }
      taggedAssets.set(assetId, assigned);
    }
    if (latestUpload) {
      latestUpload.tags = tagIds.map((id) => [...tags.values()].find((tag) => tag.id === id)?.value);
      latestUpload.tagsApplied = true;
    }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ count }));
    return;
  }
  if (request.url !== '/api/assets' || request.method !== 'POST') { response.writeHead(404); response.end(); return; }
  const form = await new Response(data, { headers: { 'Content-Type': request.headers['content-type'] } }).formData();
  const image = form.get('assetData');
  latestUpload = {
    filename: image.name, type: image.type, size: image.size,
    keyCorrect: request.headers['x-api-key'] === 'browser-test-secret',
    jpeg: Buffer.from(await image.arrayBuffer()).toString('base64'),
    deviceAssetId: form.get('deviceAssetId'),
    tags: [], tagsApplied: false,
  };
  if (failure) { failure = false; response.writeHead(403); response.end('test-secret-never-expose'); return; }
  const id = '3b3e745c-3b44-4b7f-85b3-8ed580454b87';
  const status = seen.has(latestUpload.deviceAssetId) ? 'duplicate' : 'created';
  seen.add(latestUpload.deviceAssetId);
  response.writeHead(201, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ id, status }));
});
mock.listen(18097, '127.0.0.1');
const app = createAppServer({ config: readConfig({ IMMICH_URL: 'http://127.0.0.1:18097', IMMICH_API_KEY: 'browser-test-secret', IMMICH_PUBLIC_URL: 'http://127.0.0.1:18097' }) });
app.listen(18096, '127.0.0.1', () => console.log('Browser test server listening on 18096; fake Immich 18097.'));

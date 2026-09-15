import { createServer } from 'node:http';
import { createReadStream, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
};

function positiveInteger(value, fallback, name, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === '') return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0 || result > max) {
    throw new Error(`${name} must be a positive integer no greater than ${max}.`);
  }
  return result;
}

function parseUrl(value, name) {
  if (!value) return undefined;
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an absolute HTTP or HTTPS URL.`); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must use HTTP or HTTPS, without credentials, a query, or a fragment.`);
  }
  return url;
}

export function readConfig(env = process.env) {
  const immichUrl = parseUrl(env.IMMICH_URL?.trim(), 'IMMICH_URL');
  const immichPublicUrl = parseUrl(env.IMMICH_PUBLIC_URL?.trim(), 'IMMICH_PUBLIC_URL');
  const publicOriginUrl = parseUrl(env.PUBLIC_ORIGIN?.trim(), 'PUBLIC_ORIGIN');
  if (publicOriginUrl && publicOriginUrl.pathname !== '/') {
    throw new Error('PUBLIC_ORIGIN must be only an origin, for example https://photos.example.com.');
  }
  let apiKey = env.IMMICH_API_KEY?.trim() || '';
  if (env.IMMICH_API_KEY_FILE) {
    if (apiKey) throw new Error('Set either IMMICH_API_KEY or IMMICH_API_KEY_FILE, not both.');
    try { apiKey = readFileSync(env.IMMICH_API_KEY_FILE, 'utf8').trim(); }
    catch { throw new Error('The IMMICH_API_KEY_FILE secret could not be read.'); }
  }
  const base = immichUrl?.href.replace(/\/+$/, '');
  return {
    host: env.HOST || '0.0.0.0',
    port: positiveInteger(env.PORT, 3000, 'PORT', 65535),
    maxUploadBytes: positiveInteger(env.MAX_UPLOAD_BYTES, 20 * 1024 * 1024, 'MAX_UPLOAD_BYTES', 100 * 1024 * 1024),
    uploadTimeoutMs: positiveInteger(env.IMMICH_TIMEOUT_MS, 45000, 'IMMICH_TIMEOUT_MS', 300000),
    publicOrigin: publicOriginUrl?.origin,
    immichEndpoint: base ? `${base.endsWith('/api') ? base : `${base}/api`}/assets` : undefined,
    immichPublicUrl: immichPublicUrl?.href.replace(/\/+$/, '').replace(/\/api$/, ''),
    apiKey,
    immichConfigured: Boolean(base && apiKey),
  };
}

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
}

function clientError(message, status) {
  return Object.assign(new Error(message), { status });
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    const cleanup = () => {
      request.off('data', onData);
      request.off('end', onEnd);
      request.off('error', onError);
      request.off('aborted', onAborted);
    };
    const fail = (error) => { cleanup(); request.resume(); reject(error); };
    const onData = (chunk) => {
      length += chunk.length;
      if (length > limit) return fail(clientError('The image exceeds the upload size limit.', 413));
      chunks.push(chunk);
    };
    const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks, length)); };
    const onError = () => fail(clientError('The image upload was interrupted.', 400));
    const onAborted = () => fail(clientError('The image upload was interrupted.', 400));
    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    request.once('aborted', onAborted);
  });
}

function safeFilename(header) {
  let name = typeof header === 'string' ? header : 'passport-print.jpg';
  try { name = decodeURIComponent(name); } catch { /* Keep a malformed percent escape as a literal. */ }
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  if (!name) name = 'passport-print';
  return /\.jpe?g$/i.test(name) ? name : `${name}.jpg`;
}

function verifyUploadOrigin(request, config) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw clientError('Cross-site uploads are not allowed.', 403);
  }
  // X-Filename makes browser uploads non-simple requests. No CORS or OPTIONS
  // permission is granted, so another website cannot submit a blind upload.
  if (!request.headers['x-filename']) throw clientError('The X-Filename upload header is required.', 400);
  if (request.headers.origin) {
    const scheme = request.socket.encrypted ? 'https' : 'http';
    const expected = config.publicOrigin || `${scheme}://${request.headers.host}`;
    if (request.headers.origin !== expected) {
      throw clientError('The upload origin does not match this app. Check PUBLIC_ORIGIN behind a reverse proxy.', 403);
    }
  }
}

function photoTags(request) {
  const dimensions = ['x-photo-width', 'x-photo-height'].map((header) => {
    const value = request.headers[header];
    if (typeof value !== 'string' || value.length > 24 || !/^\d+(?:\.\d+)?$/.test(value.trim())) {
      throw clientError('Provide X-Photo-Width and X-Photo-Height as photo dimensions in millimeters.', 400);
    }
    const dimension = Number(value);
    if (!Number.isFinite(dimension) || dimension < 1 || dimension > 1000) {
      throw clientError('Photo dimensions must be between 1 and 1,000 mm.', 400);
    }
    return String(dimension);
  });
  return ['pass photo', `${dimensions[0]}x${dimensions[1]} mm`];
}

async function tagSavedAsset(config, assetId, tags, signal) {
  const endpoint = config.immichEndpoint.replace(/\/assets$/, '/tags');
  const put = async (url, body) => {
    const response = await fetch(url, {
      method: 'PUT', headers: { 'x-api-key': config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal, redirect: 'manual',
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(new Error('Tag request failed.'), { upstreamStatus: response.status });
    }
    return response.json();
  };
  try {
    // Immich upserts by (user, tag value), preserving existing tags and handling
    // concurrent saves without a separate lookup/create race.
    const upserted = await put(endpoint, { tags });
    const tagIds = tags.map((value) => Array.isArray(upserted) && upserted.find((tag) => tag.value === value)?.id);
    if (tagIds.some((id) => typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) || new Set(tagIds).size !== tags.length) {
      throw new Error('Immich returned incomplete tags.');
    }
    // The bulk endpoint ignores already-present associations. A count of zero
    // is valid when saving an unchanged, previously tagged image again.
    const applied = await put(`${endpoint}/assets`, { tagIds, assetIds: [assetId] });
    if (!Number.isInteger(applied?.count) || applied.count < 0 || applied.count > tags.length) {
      throw new Error('Immich returned an unexpected tagging response.');
    }
    return { tags, tagsApplied: true };
  } catch (error) {
    const help = [401, 403].includes(error.upstreamStatus)
      ? ' Check that the API key has tag.create and tag.asset permissions.'
      : error.name === 'TimeoutError' || error.name === 'AbortError'
        ? ' Immich took too long to respond.'
        : ' Check the Immich connection and tagging permissions.';
    return {
      tags, tagsApplied: false,
      warning: `The photo is saved in Immich, but its tags could not be confirmed.${help}`,
    };
  }
}

async function uploadToImmich(request, response, config) {
  verifyUploadOrigin(request, config);
  if (!config.immichConfigured) throw clientError('Immich is not configured on this server.', 503);
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'image/jpeg') {
    throw clientError('Upload a JPEG print sheet.', 415);
  }
  const tags = photoTags(request);
  const declaredLength = Number(request.headers['content-length']);
  if (declaredLength > config.maxUploadBytes) throw clientError('The image exceeds the upload size limit.', 413);
  const data = await readBody(request, config.maxUploadBytes);
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8 || data[2] !== 0xff) {
    throw clientError('The upload does not contain a JPEG image.', 400);
  }
  const form = new FormData();
  const now = new Date().toISOString();
  form.set('assetData', new Blob([data], { type: 'image/jpeg' }), safeFilename(request.headers['x-filename']));
  form.set('deviceAssetId', `passport-print-${createHash('sha256').update(data).digest('hex')}`);
  form.set('deviceId', 'passport-photo-printer');
  form.set('fileCreatedAt', now);
  form.set('fileModifiedAt', now);
  const upstreamSignal = AbortSignal.timeout(config.uploadTimeoutMs);
  let upstream;
  try {
    upstream = await fetch(config.immichEndpoint, {
      method: 'POST', headers: { 'x-api-key': config.apiKey }, body: form,
      signal: upstreamSignal, redirect: 'manual',
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw clientError('Immich did not respond in time. Try saving again.', 504);
    }
    throw clientError('Could not connect to Immich. Check the server URL and network connection.', 502);
  }
  if (!upstream.ok) {
    await upstream.body?.cancel();
    if (upstream.status >= 300 && upstream.status < 400) {
      throw clientError('Immich redirected the upload. Set IMMICH_URL to its direct server address.', 502);
    }
    if ([401, 403].includes(upstream.status)) {
      throw clientError('Immich refused the API key. Check that the key is valid and has the asset.upload permission.', 502);
    }
    if (upstream.status === 413) throw clientError('Immich or its reverse proxy rejected the image as too large.', 413);
    if ([400, 415, 422].includes(upstream.status)) throw clientError('Immich rejected the image upload. Check the Immich server logs.', 502);
    throw clientError(`Immich could not save the image (HTTP ${upstream.status}). Try again later.`, 502);
  }
  let result;
  try { result = await upstream.json(); }
  catch { throw clientError('Immich returned an unexpected response.', 502); }
  if (typeof result.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(result.id)) {
    throw clientError('Immich did not return a valid saved image identifier.', 502);
  }
  const tagging = await tagSavedAsset(config, result.id, tags, upstreamSignal);
  sendJson(response, 200, {
    id: result.id,
    status: result.status === 'duplicate' ? 'duplicate' : 'created',
    ...tagging,
    ...(config.immichPublicUrl ? { url: `${config.immichPublicUrl}/photos/${encodeURIComponent(result.id)}` } : {}),
  });
}

async function serveStatic(request, response, pathname, distPath) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw clientError('Invalid URL encoding.', 400); }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some((part) => part === '..' || part.startsWith('.'))) {
    throw clientError('Not found.', 404);
  }
  const root = path.resolve(distPath);
  let target = path.resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw clientError('Not found.', 404);
  let info;
  try { info = await stat(target); } catch { /* Decide whether this is an SPA route below. */ }
  if (info?.isDirectory()) {
    target = path.join(target, 'index.html');
    try { info = await stat(target); } catch { info = undefined; }
  }
  if (!info?.isFile()) {
    if (decoded.startsWith('/assets/') || path.extname(decoded) || !request.headers.accept?.includes('text/html')) throw clientError('Not found.', 404);
    target = path.join(root, 'index.html');
    try { info = await stat(target); }
    catch { throw clientError('The app has not been built. Run npm run build first.', 503); }
  }
  response.writeHead(200, {
    'Content-Type': mimeTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': decoded.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') return response.end();
  const stream = createReadStream(target);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}

export function createAppServer({ config = readConfig(), distPath = path.join(projectRoot, 'dist') } = {}) {
  return createServer({ requestTimeout: 120000, headersTimeout: 15000 }, async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
    response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'self'; img-src 'self' blob: data:; manifest-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:");
    try {
      // Keep the raw path: URL() normalizes dot segments before traversal checks.
      const pathname = (request.url || '/').split('?')[0];
      if (pathname === '/api/health' && request.method === 'GET') return sendJson(response, 200, { status: 'ok' });
      if (pathname === '/api/config' && request.method === 'GET') {
        return sendJson(response, 200, {
          immichConfigured: config.immichConfigured,
          maxUploadBytes: config.maxUploadBytes,
          ...(config.immichPublicUrl ? { immichWebUrl: config.immichPublicUrl } : {}),
        });
      }
      if (pathname === '/api/immich/upload' && request.method === 'POST') return await uploadToImmich(request, response, config);
      if (pathname.startsWith('/api/')) throw clientError('API endpoint not found.', 404);
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        throw clientError('Method not allowed.', 405);
      }
      await serveStatic(request, response, pathname, distPath);
    } catch (error) {
      request.resume();
      if (!response.headersSent && !response.destroyed) {
        sendJson(response, error.status || 500, { error: error.status ? error.message : 'An unexpected server error occurred.' });
      }
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = readConfig();
    const server = createAppServer({ config });
    server.listen(config.port, config.host, () => {
      console.log(`Passport Photo Printer listening on port ${config.port}. Immich ${config.immichConfigured ? 'enabled' : 'not configured'}.`);
    });
    server.on('error', (error) => {
      console.error(`Server could not start (${error.code || 'unknown error'}).`);
      process.exitCode = 1;
    });
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, () => {
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 10000).unref();
      });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

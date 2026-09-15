// Optional daemon-free image packaging for Windows hosts without Docker.
// This assembles the already-built dist/ directory; it does not run Dockerfile.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, cp, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = path.join(root, 'test-results', 'image-build');
const version = 'v0.22.1';
const platform = process.env.IMAGE_PLATFORM || 'linux/amd64';
const tag = 'passport-photo-printer:local';
const releaseUrl = `https://github.com/google/go-containerregistry/releases/download/${version}`;
const asset = `go-containerregistry_${process.platform === 'win32' ? 'Windows' : 'Linux'}_x86_64.tar.gz`;
const crane = path.join(work, process.platform === 'win32' ? 'crane.exe' : 'crane');
const output = path.resolve(process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) || path.join(root, 'test-results', 'passport-photo-printer-image.tar'));
const sha = (data) => createHash('sha256').update(data).digest('hex');
const isolatedDockerConfig = path.join(work, `empty-docker-config-${Date.now()}`);
const commandEnvironment = { ...process.env, DOCKER_CONFIG: isolatedDockerConfig };
delete commandEnvironment.IMMICH_API_KEY;
delete commandEnvironment.IMMICH_API_KEY_FILE;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, env: commandEnvironment, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.stderr || result.stdout || result.error}`);
  return result.stdout.trim();
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} from ${new URL(url).hostname}`);
  return Buffer.from(await response.arrayBuffer());
}

await mkdir(work, { recursive: true });
await mkdir(isolatedDockerConfig, { recursive: true });
let toolHash;
try {
  const provenance = JSON.parse(await readFile(path.join(work, 'crane-provenance.json'), 'utf8'));
  const archive = await readFile(path.join(work, asset));
  if (provenance.version !== version || sha(archive) !== provenance.sha256) throw new Error('Cached tool checksum mismatch.');
  await access(crane);
  toolHash = provenance.sha256;
} catch {
  console.log(`Downloading official crane ${version} and published SHA-256 checksums…`);
  const [archive, checksums] = await Promise.all([download(`${releaseUrl}/${asset}`), download(`${releaseUrl}/checksums.txt`)]);
  const checksumText = checksums.toString('utf8');
  const expected = checksumText.split(/\r?\n/).find((line) => line.trim().endsWith(asset))?.trim().split(/\s+/)[0];
  toolHash = sha(archive);
  if (!expected || expected.toLowerCase() !== toolHash) throw new Error('Official crane release checksum verification failed.');
  await writeFile(path.join(work, asset), archive);
  await writeFile(path.join(work, 'checksums.txt'), checksums);
  run('tar', ['-xzf', path.join(work, asset), '-C', work, path.basename(crane)]);
  await writeFile(path.join(work, 'crane-provenance.json'), JSON.stringify({ version, asset, sha256: toolHash, source: `${releaseUrl}/${asset}` }, null, 2));
}
// Always extract the binary from the checksum-verified archive, including when
// reusing a cached download, instead of trusting a possibly stale executable.
run('tar', ['-xzf', path.join(work, asset), '-C', work, path.basename(crane)]);
console.log(`crane ${run(crane, ['version'])}; verified archive SHA-256 ${toolHash}`);
if (process.argv.includes('--prepare')) process.exit(0);

await access(path.join(root, 'dist', 'index.html'));
await mkdir(path.dirname(output), { recursive: true });
const layerRoot = path.join(work, `layer-${Date.now()}`);
const appRoot = path.join(layerRoot, 'app');
await mkdir(appRoot, { recursive: true });
await cp(path.join(root, 'dist'), path.join(appRoot, 'dist'), { recursive: true });
await cp(path.join(root, 'server'), path.join(appRoot, 'server'), { recursive: true });
const layerPath = path.join(work, 'app-layer.tar');
run('tar', ['--format=ustar', '--uid', '1000', '--gid', '1000', '-cf', layerPath, '-C', layerRoot, 'app']);

console.log(`Resolving official node:24-alpine for ${platform}…`);
const baseDigest = run(crane, ['digest', 'node:24-alpine', '--platform', platform]);
const baseReference = `index.docker.io/library/node@${baseDigest}`;
const baseConfig = JSON.parse(run(crane, ['config', baseReference, '--platform', platform]));
console.log(`Appending application to ${baseReference}…`);
const intermediate = path.join(work, 'assembled.tar');
run(crane, [
  'mutate', baseReference, '--platform', platform, '--append', layerPath,
  '--cmd', 'node,server/index.mjs', '--user', 'node', '--workdir', '/app',
  '--env', 'NODE_ENV=production', '--env', 'HOST=0.0.0.0', '--env', 'PORT=3000',
  '--exposed-ports', '3000/tcp', '--tag', tag, '--output', intermediate,
], { stdio: ['ignore', 'pipe', 'inherit'] });

// crane has no healthcheck flag. Patch only the generated archive's image
// configuration, retaining every verified base/application layer unchanged.
const entries = run('tar', ['-tf', intermediate]).split(/\r?\n/).filter(Boolean);
if (entries.some((name) => name.startsWith('/') || name.includes('\\') || name.split('/').includes('..') || /^[a-z]:/i.test(name))) {
  throw new Error('Unexpected unsafe path in the generated image archive.');
}
const archiveRoot = path.join(work, `archive-${Date.now()}`);
await mkdir(archiveRoot, { recursive: true });
const manifest = JSON.parse(run('tar', ['-xOf', intermediate, 'manifest.json']));
if (manifest.length !== 1) throw new Error('Expected a single image in the archive.');
const originalConfigPath = manifest[0].Config;
if (![originalConfigPath, ...manifest[0].Layers].every((entry) => entries.includes(entry))) {
  throw new Error('Image manifest refers to entries missing from the archive.');
}
// crane's config member is named "sha256:…". Read that member from the
// archive directly because colons are not valid normal Windows filenames.
const config = JSON.parse(run('tar', ['-xOf', intermediate, originalConfigPath]));
run('tar', ['-xf', intermediate, '-C', archiveRoot, ...manifest[0].Layers]);
config.config.Healthcheck = {
  Test: ['CMD-SHELL', "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""],
  Interval: 30000000000, Timeout: 3000000000, StartPeriod: 5000000000, Retries: 3,
};
const finalConfig = Buffer.from(JSON.stringify(config));
const configDigest = sha(finalConfig);
const newConfigPath = `${configDigest}.json`;
await writeFile(path.join(archiveRoot, newConfigPath), finalConfig);
manifest[0].Config = newConfigPath;
await writeFile(path.join(archiveRoot, 'manifest.json'), JSON.stringify(manifest));
const finalEntries = ['manifest.json', newConfigPath, ...manifest[0].Layers];
run('tar', ['--format=ustar', '-cf', output, '-C', archiveRoot, ...finalEntries]);

if (config.architecture !== platform.split('/')[1] || config.os !== 'linux' || config.config.User !== 'node' || config.config.WorkingDir !== '/app') {
  throw new Error('Final image platform or runtime configuration does not match the intended Docker configuration.');
}
if (JSON.stringify(config.config.Cmd) !== JSON.stringify(['node', 'server/index.mjs'])) throw new Error('Final image command does not match.');
const validation = run(crane, ['validate', '--tarball', output]);
if (validation) console.log(validation);
const imageBytes = await readFile(output);
const provenance = {
  imageTag: tag, platform, createdAt: new Date().toISOString(), bytes: imageBytes.length,
  archiveSha256: sha(imageBytes), imageConfigDigest: `sha256:${configDigest}`,
  baseImage: 'node:24-alpine', baseDigest, nodeVersion: baseConfig.config.Env.find((entry) => entry.startsWith('NODE_VERSION='))?.split('=')[1],
  crane: { version, archive: asset, sha256: toolHash, release: `https://github.com/google/go-containerregistry/releases/tag/${version}` },
  method: 'Daemon-free layer assembly of locally built dist/ and server/. Dockerfile was not executed; runtime execution was not tested.',
};
await writeFile(output.replace(/\.tar$/, '') + '.provenance.json', JSON.stringify(provenance, null, 2));
console.log(JSON.stringify(provenance, null, 2));

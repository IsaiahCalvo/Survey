import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distributionStore, PUBLIC_BASE } from './lib/public-distribution.mjs';

// Use electron-updater's own YAML dependency, matching the reader in the app.
const require = createRequire(import.meta.url);
const yaml = createRequire(require.resolve('electron-updater'))('js-yaml');

export function publicUpdateManifest(text, version, assets) {
  const info = yaml.load(text);
  if (info.version !== version) throw new Error('Update version differs from release version');
  if (!Array.isArray(info.files) || !info.files.length) throw new Error('Update has no files');
  for (const file of info.files) {
    const data = assets.get(file.url);
    if (!data || basename(file.url) !== file.url) throw new Error('Update file is missing or has an unsafe path');
    if (createHash('sha512').update(data).digest('base64') !== file.sha512) throw new Error('Update checksum differs from file');
    if (file.size !== undefined && file.size !== data.length) throw new Error('Update size differs from file');
    file.url = `v${version}/${file.url}`;
  }
  if (!assets.has(info.path)) throw new Error('Update path is missing');
  if (createHash('sha512').update(assets.get(info.path)).digest('base64') !== info.sha512) throw new Error('Update path checksum differs from file');
  info.path = `v${version}/${info.path}`;
  return yaml.dump(info);
}

export function assertFeedVersion(current, next) {
  if (!/^\d+\.\d+\.\d+$/.test(current)) throw new Error('Published feed has an invalid version');
  const a = current.split('.').map(Number), b = next.split('.').map(Number);
  const first = a.findIndex((part, index) => part !== b[index]);
  if (first >= 0 && a[first] > b[first]) throw new Error('Refusing to replace a newer public update feed');
}

export async function publishDownloads(directory, tag) {
  const store = await distributionStore();
  await store.ensureBucket();
  if (/^app-(stable|nightly)$/.test(tag)) {
    const name = `survey-${tag.slice(4)}.apk`;
    await store.put(`android/${name}`, await readFile(join(directory, name)), 'application/vnd.android.package-archive', true);
    return;
  }
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Use a stable vX.Y.Z release tag');
  const version = tag.slice(1);
  const names = (await readdir(directory)).filter((name) => /^survey-[\w. -]+\.(?:exe|dmg|zip|blockmap)$/.test(name));
  if (!names.length || names.some((name) => !name.includes(version))) throw new Error('Missing or mismatched installer version');
  const assets = new Map(await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name))])));
  const manifests = [];
  for (const name of ['latest.yml', 'latest-mac.yml']) {
    const text = await readFile(join(directory, name), 'utf8').catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (text) manifests.push([name, publicUpdateManifest(text, version, assets)]);
  }
  if (!manifests.length) throw new Error('Missing update manifest');
  for (const [name] of manifests) {
    const response = await fetch(`${PUBLIC_BASE}/desktop/${name}?check=${Date.now()}`, { signal: AbortSignal.timeout(30_000) });
    if (response.ok) assertFeedVersion(String(yaml.load(await response.text()).version), version);
    else if (response.status !== 404 && response.status !== 400) throw new Error(`Could not check current update feed (${response.status})`);
  }
  // Versioned files first, feeds last. A failed upload must not advertise an incomplete release.
  for (const [name, data] of assets) await store.put(`desktop/${tag}/${name}`, data);
  for (const [name, data] of manifests) await store.put(`desktop/${name}`, data, 'text/yaml', true);
  console.log(`Published ${assets.size} app files and ${manifests.length} update feeds`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publishDownloads(process.argv[2] || 'release', process.argv[3] || process.env.GITHUB_REF_NAME)
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

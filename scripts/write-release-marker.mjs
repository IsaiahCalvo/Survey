import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function resolveReleaseCommit(env = process.env, cwd = process.cwd()) {
  for (const candidate of [env.VERCEL_GIT_COMMIT_SHA, env.GITHUB_SHA]) {
    if (/^[0-9a-f]{40}$/i.test(candidate || '')) return candidate.toLowerCase();
  }

  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  const commit = git.stdout?.trim();
  if (git.status === 0 && /^[0-9a-f]{40}$/i.test(commit || '')) return commit.toLowerCase();
  throw new Error('Unable to resolve the release commit');
}

export function writeReleaseMarker({
  cwd = process.cwd(),
  env = process.env,
  now = new Date(),
} = {}) {
  const marker = {
    commit: resolveReleaseCommit(env, cwd),
    builtAt: now.toISOString(),
  };
  const outputPath = resolve(cwd, 'public', 'release.json');
  writeFileSync(outputPath, `${JSON.stringify(marker)}\n`, { encoding: 'utf8', mode: 0o644 });
  return { marker, outputPath };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { marker } = writeReleaseMarker();
  console.log(`Release marker: ${marker.commit}`);
}

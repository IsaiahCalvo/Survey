#!/usr/bin/env node
// Sets iOS MARKETING_VERSION/CURRENT_PROJECT_VERSION and Android versionName/versionCode
// from package.json "version". Build number: first CLI arg, else BUILD_NUMBER env,
// else git commit count. Usage: node scripts/native-version.mjs [buildNumber] [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const positional = args.filter((a) => !a.startsWith('--'));

const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`package.json version "${version}" must be X.Y.Z for the stores`);
}

let build = positional[0] ?? process.env.BUILD_NUMBER;
if (!build) build = execSync('git rev-list --count HEAD', { cwd: root }).toString().trim();
// Play caps versionCode at 2100000000; both stores need it to increase every upload.
if (!/^\d+$/.test(build) || Number(build) < 1 || Number(build) > 2100000000) {
  throw new Error(`build number "${build}" must be a positive integer <= 2100000000`);
}

const targets = [
  {
    file: 'ios/App/App.xcodeproj/project.pbxproj',
    edits: [
      [/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${version};`],
      [/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`],
    ],
  },
  {
    file: 'android/app/build.gradle',
    edits: [
      [/versionCode \d+/, `versionCode ${build}`],
      [/versionName "[^"]*"/, `versionName "${version}"`],
    ],
  },
];

let drift = false;
for (const { file, edits } of targets) {
  const p = path.join(root, file);
  const before = readFileSync(p, 'utf8');
  let after = before;
  for (const [re, rep] of edits) {
    if (!after.match(re)) throw new Error(`${file}: pattern ${re} not found`);
    after = after.replace(re, rep);
  }
  const changed = after !== before;
  if (changed) {
    drift = true;
    if (!check) writeFileSync(p, after);
  }
  console.log(`${check ? (changed ? 'DRIFT' : 'ok   ') : changed ? 'set  ' : 'same '} ${file}`);
}
console.log(`version ${version} build ${build}`);
if (check && drift) process.exit(1);

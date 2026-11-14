#!/usr/bin/env node
// Builds the Microsoft Teams app package (Drawboard Projects parity IN-28):
// teams-app/manifest.json + its two icons, zipped, with the site filled in.
//   node scripts/build-teams-app.mjs [nightly|stable] [out.zip]
// Nightly (the default) points the tab at Survey Nightly; stable at
// surveytool.app. A Teams admin uploads the zip (Teams admin center >
// Manage apps > Upload new app), or a person with custom-app upload allowed
// uses Apps > Manage your apps > Upload an app.
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

export const TEAMS_SITES = Object.freeze({
  nightly: 'https://surveytool-nightly.vercel.app',
  stable: 'https://surveytool.app',
});

export function teamsManifest(channel = 'nightly', root = process.cwd()) {
  const site = TEAMS_SITES[channel];
  if (!site) throw new Error(`Unknown channel "${channel}": use nightly or stable`);
  const text = fs.readFileSync(path.join(root, 'teams-app', 'manifest.json'), 'utf8').replaceAll('{{SITE}}', site);
  const manifest = JSON.parse(text);
  if (channel === 'nightly') {
    manifest.name.short = 'Survey Nightly';
    manifest.name.full = `${manifest.name.full} (Nightly)`;
  }
  return manifest;
}

export async function buildTeamsApp(channel = 'nightly', root = process.cwd()) {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(teamsManifest(channel, root), null, 2));
  for (const icon of ['color.png', 'outline.png']) zip.file(icon, fs.readFileSync(path.join(root, 'teams-app', icon)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const channel = process.argv[2] || 'nightly';
  const out = process.argv[3] || `survey-teams-app-${channel}.zip`;
  fs.writeFileSync(out, await buildTeamsApp(channel));
  console.log(`Wrote ${out}`);
}

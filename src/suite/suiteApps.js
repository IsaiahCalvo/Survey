// Where the other Kal Voe apps live (KAL-648). Nightly opens the other app's
// Nightly, so a tester stays on the copies that carry the suite parts.
const WALKTHRU_URLS = {
  stable: 'https://walkthru.tools',
  nightly: 'https://walkthu-nightly.vercel.app',
};

export function walkthruAppUrl(channel) {
  return WALKTHRU_URLS[channel] || WALKTHRU_URLS.stable;
}

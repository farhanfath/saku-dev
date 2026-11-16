export function isSafeUpdate(update) {
  const artifact = update.rawJson?.platforms?.['windows-x86_64'];
  const rawJson = JSON.stringify(update.rawJson);
  let url;
  try { url = new URL(artifact?.url); } catch { return false; }
  return /^\d+\.\d+\.\d+$/.test(update.version)
    && (update.body == null || (typeof update.body === 'string' && update.body.length <= 12000))
    && rawJson !== undefined && rawJson.length <= 65536
    && typeof artifact.signature === 'string' && !!artifact.signature.trim()
    && url.origin === 'https://github.com'
    && /^\/farhanfath\/saku-dev\/releases\/download\/[^/]+\/[^/]+$/.test(url.pathname);
}

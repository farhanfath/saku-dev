const OWNER = "farhanfath";
const REPOSITORY = "saku-dev";
const RELEASES_PAGE = `https://github.com/${OWNER}/${REPOSITORY}/releases`;
const GITHUB_LATEST = `https://api.github.com/repos/${OWNER}/${REPOSITORY}/releases/latest`;

export function publicRelease(release) {
  if (!release || release.draft || release.prerelease || typeof release.tag_name !== "string") return null;

  const match = release.tag_name.match(/^v?(\d+\.\d+\.\d+)$/);
  if (!match || !Array.isArray(release.assets)) return null;

  const version = match[1];
  const installerName = `Saku_${version}_x64-setup.exe`;
  const assetNames = new Set(release.assets.map(({ name }) => name));
  const installer = release.assets.find(({ name, browser_download_url }) =>
    name === installerName && browser_download_url === `${RELEASES_PAGE}/download/${release.tag_name}/${installerName}`
  );
  if (!installer || !assetNames.has(`${installerName}.sig`) || !assetNames.has("latest.json")) return null;

  const releaseUrl = typeof release.html_url === "string" && release.html_url.startsWith(RELEASES_PAGE + "/tag/")
    ? release.html_url
    : RELEASES_PAGE;

  return {
    available: true,
    version,
    date: typeof release.published_at === "string" ? release.published_at : null,
    notes: typeof release.body === "string" ? release.body.slice(0, 12000) : "",
    downloadUrl: installer.browser_download_url,
    releaseUrl,
  };
}

export default async function handler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.status(405).json({ available: false, releaseUrl: RELEASES_PAGE });
    return;
  }

  try {
    const upstream = await fetch(GITHUB_LATEST, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "saku-landing" },
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) throw new Error(`GitHub returned ${upstream.status}`);
    const release = publicRelease(await upstream.json());
    response.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    response.status(200).json(release || { available: false, releaseUrl: RELEASES_PAGE });
  } catch {
    response.setHeader("Cache-Control", "no-store");
    response.status(503).json({ available: false, releaseUrl: RELEASES_PAGE });
  }
}

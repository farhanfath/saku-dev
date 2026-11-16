import test from "node:test";
import assert from "node:assert/strict";
import handler, { publicRelease } from "../api/release.mjs";

const stable = {
  tag_name: "v0.3.0",
  draft: false,
  prerelease: false,
  published_at: "2026-11-16T10:00:00Z",
  body: "Catatan **rilis**",
  html_url: "https://github.com/farhanfath/saku-dev/releases/tag/v0.3.0",
  assets: [
    { name: "Saku_0.3.0_x64-setup.exe", browser_download_url: "https://github.com/farhanfath/saku-dev/releases/download/v0.3.0/Saku_0.3.0_x64-setup.exe" },
    { name: "Saku_0.3.0_x64-setup.exe.sig" },
    { name: "latest.json" },
  ],
};

test("exposes a stable release and its real Windows installer", () => {
  assert.deepEqual(publicRelease(stable), {
    available: true,
    version: "0.3.0",
    date: stable.published_at,
    notes: stable.body,
    downloadUrl: stable.assets[0].browser_download_url,
    releaseUrl: stable.html_url,
  });
});

test("does not expose drafts, prereleases, malformed versions, or incomplete releases", () => {
  assert.equal(publicRelease({ ...stable, draft: true }), null);
  assert.equal(publicRelease({ ...stable, prerelease: true }), null);
  assert.equal(publicRelease({ ...stable, tag_name: "v0.3.0-rc.1" }), null);
  assert.equal(publicRelease({ ...stable, tag_name: "latest" }), null);
  assert.equal(publicRelease({ ...stable, assets: [] }), null);
  assert.equal(publicRelease({ ...stable, assets: stable.assets.slice(0, 2) }), null);
  assert.equal(publicRelease({ ...stable, assets: stable.assets.slice(1) }), null);
});

test("requires the exact versioned Windows x64 installer and release asset URL", () => {
  assert.equal(publicRelease({ ...stable, assets: [{ ...stable.assets[0], name: "Saku_0.3.0_arm64-setup.exe" }, ...stable.assets.slice(1)] }), null);
  assert.equal(publicRelease({ ...stable, assets: [{ ...stable.assets[0], name: "Saku_0.2.1_x64-setup.exe" }, ...stable.assets.slice(1)] }), null);
  assert.equal(publicRelease({ ...stable, assets: [{ ...stable.assets[0], browser_download_url: "https://example.com/installer.exe" }, ...stable.assets.slice(1)] }), null);
});

test("accepts only assets hosted by the project's GitHub releases", () => {
  assert.equal(publicRelease({ ...stable, assets: [{ name: "installer.exe", browser_download_url: "https://example.com/installer.exe" }] }), null);
  assert.equal(publicRelease({ ...stable, assets: [{ name: "notes.txt", browser_download_url: stable.assets[0].browser_download_url }] }), null);
});

async function request(method, fetchImpl) {
  const headers = {};
  let statusCode;
  let body;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await handler({ method }, {
      setHeader: (name, value) => { headers[name] = value; },
      status(code) { statusCode = code; return this; },
      json(value) { body = value; },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  return { headers, statusCode, body };
}

test("serves a complete release with a short shared cache", async () => {
  const result = await request("GET", async () => ({ ok: true, json: async () => stable }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.downloadUrl, stable.assets[0].browser_download_url);
  assert.equal(result.headers["Cache-Control"], "public, s-maxage=300, stale-while-revalidate=600");
});

test("does not cache upstream failures and rejects writes", async () => {
  const unavailable = await request("GET", async () => { throw new Error("offline"); });
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body.available, false);
  assert.equal(unavailable.headers["Cache-Control"], "no-store");

  const rejected = await request("POST", async () => { throw new Error("must not fetch"); });
  assert.equal(rejected.statusCode, 405);
  assert.equal(rejected.headers.Allow, "GET, HEAD");
});


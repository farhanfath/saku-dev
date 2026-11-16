const releasesUrl = "/api/release";

const releaseButton = document.querySelector("#download-button");
const downloadLabel = document.querySelector(".download-label");
const status = document.querySelector("#release-status");
const releaseSummary = document.querySelector("#release-summary");
const releaseVersion = document.querySelector("#release-version");
const releaseDate = document.querySelector("#release-date");
const releaseDetails = document.querySelector("#release-details");
const releaseLink = document.querySelector("#release-link");

function plainSummary(value) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("id-ID", { dateStyle: "long", timeZone: "Asia/Jakarta" }).format(date);
}

try {
  const response = await fetch(releasesUrl, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("release unavailable");
  const release = await response.json();

  if (release.available && release.version && release.downloadUrl) {
    releaseButton.href = release.downloadUrl;
    releaseButton.target = "_blank";
    releaseButton.rel = "noreferrer";
    downloadLabel.textContent = `Unduh Saku ${release.version}`;
    status.textContent = release.date ? `Rilis stabil · ${formatDate(release.date)}` : "Installer Windows x64 tersedia";
    releaseSummary.textContent = plainSummary(release.notes || "Rilis stabil terbaru untuk Windows x64.") || "Rilis stabil terbaru untuk Windows x64.";
    releaseVersion.textContent = `Versi ${release.version}`;
    releaseDate.textContent = formatDate(release.date);
    if (release.date) releaseDate.dateTime = release.date;
    releaseDetails.href = release.releaseUrl;
    releaseLink.href = release.releaseUrl;
  } else {
    status.textContent = "Belum ada installer stabil. Cek halaman rilis di GitHub.";
    releaseSummary.textContent = "Belum ada rilis stabil yang tersedia. Kunjungi GitHub untuk melihat status terbaru.";
    if (release.releaseUrl) {
      releaseDetails.href = release.releaseUrl;
      releaseLink.href = release.releaseUrl;
    }
  }
} catch {
  status.textContent = "Info rilis sedang tidak tersedia. Cek GitHub Releases.";
  releaseSummary.textContent = "Informasi rilis gagal dimuat. Catatan resmi tetap tersedia di GitHub.";
}

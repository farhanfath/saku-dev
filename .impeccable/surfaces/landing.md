---
version: 1
slug: "landing"
primary_target: "website/index.html"
related_targets: ["website/styles.css", "website/release.js", "website/api/release.mjs"]
---

# Saku public landing page

Mode: Discover and download. The shipped page introduces Saku’s Windows tools and routes visitors to the verified stable installer.

## Direction

THESIS: Make practical file work feel clear and manageable; show the actual desktop app so visitors can judge the tools before downloading.

OWN-WORLD: Extend Saku’s petrol and teal identity into a cool-white public page. Use the canonical Saku mark, Manrope for display and wordmark, and Segoe UI for reading copy. The website palette uses paper `#f6f8f7`, petrol `#183f48`, teal `#087f70`, ink `#19363d`, and muted ink `#536b70`; keep the established desktop application colors and typography documented in the root `DESIGN.md` intact.

STORY: Introduce the product and Windows x64 availability, show Batch Rename and Markdown in real screenshots, explain installation, summarize the latest stable release, answer privacy/update questions, and link to the repository and release notes.

FIRST VIEWPORT: A compact header anchors the Saku mark, section links, and repository link. The hero places a large two-line benefit statement, short introduction, Windows download action, release status, and platform/product facts beside overlapping screenshots of the two shipped tools. Use the existing screenshots and the favicon mark; do not create product mockups.

FORM: A public, Indonesian-language utility landing page. Keep the web styles in `website/`; they do not redefine the desktop app’s identity.

## Shipped expression

- The content container is capped at 1200px, with 40px side gutters by default, 26px at widths up to 900px, and 20px at widths up to 650px.
- At desktop widths, the hero and tool features use two columns; the tool screenshots alternate sides. The installation and FAQ sections use paired text/content columns. At 650px and below, sections stack, the Markdown screenshot precedes its copy, and the installation steps become vertical. At 900px and below, release metadata and the release link wrap to separate rows.
- Main headings use Manrope with a tight negative tracking; the hero scales from 55px to 88px on desktop and from 52px to 72px on narrow screens. Body copy uses Segoe UI/system sans at 16px, with smaller supporting labels. Feature labels are small uppercase text with increased tracking.
- Cards and screenshots use restrained borders, 4–8px corners, and a soft screenshot shadow. Teal is reserved for the primary download action, links, focus, bullets, and small status marks. The installation band and footer use deep petrol; the release summary uses pale teal.
- The hero’s two real application screenshots overlap to show both tools at once. Tool feature blocks pair one screenshot with a concise explanation and a short list; keep the image captions and alt text informative.

## Interaction and release states

- The primary download action initially points to the GitHub Releases page and says “Lihat rilis Windows” while the page checks `/api/release`. The adjacent live status says “Memeriksa rilis…”.
- When metadata confirms a stable release with a version and Windows installer URL, the action changes to “Unduh Saku {version}”, links directly to the installer, and the nearby status shows the release date when present. The release panel shows the same version, date, sanitized plain-text notes, and official release notes link.
- If the endpoint responds but no qualifying stable installer is available, keep the release-page link and show “Belum ada installer stabil. Cek halaman rilis di GitHub.” The summary says no stable release is available.
- If the check fails, keep the safe GitHub release fallback and show “Info rilis sedang tidak tersedia. Cek GitHub Releases.” The summary explains that release information failed to load. Do not imply that a download is available in either fallback state.
- Release data is accepted only for a non-draft, non-prerelease semantic version with the matching x64 installer, signature, and updater metadata. Website copy strips Markdown syntax, limits release notes, and displays them as text.
- FAQ rows use native `details`/`summary`, so keyboard users can expand them without script state. Links and summaries have visible focus; smooth scrolling and transitions are reduced when `prefers-reduced-motion` is set. Preserve the skip link and meaningful screenshot alternatives.

## Evidence

The shipped source is `website/index.html`, `website/styles.css`, `website/release.js`, and `website/api/release.js`. The captured review set is `.impeccable/review/landing/{desktop,tablet,mobile,faq-open}.png`. Desktop, tablet, and mobile captures show the corresponding layouts; the FAQ-open capture shows the native disclosure expanded. That capture also contains a literal script-shaped release-note string, which is not landing-page copy or a visual rule and must not be repeated.

FINISH: Preserve the verified release states and actual product screenshots when adjusting the page. Do not treat a local capture or fixture response as proof that a production installer or deployment exists.

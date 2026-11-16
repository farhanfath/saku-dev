# Windows draft release

1. Confirm `main` has passed CI and the package, Tauri, and Cargo versions match.
2. Create and push a `vX.Y.Z` tag at the reviewed `main` commit. The tag workflow checks that ancestry and creates a GitHub draft only.
3. Alternatively, run **Draft Windows release** from `main` and enter a tag that points at that exact commit.
4. The workflow replaces Tauri Action's API asset URLs with the exact versioned public installer URL, validates the signature, and downloads the uploaded manifest again for verification.
5. Review the NSIS installer, `.sig`, and `latest.json` on the draft release. When replacing the draft notes, also update `notes` in `latest.json` before publishing so the app shows the same changelog. Publish the draft manually only after the coordinator's native upgrade and integration checks pass.

The repository secret `TAURI_SIGNING_PRIVATE_KEY` is required. The key must be the Tauri updater key paired with the public key embedded by the application. `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is only needed for a password-protected key. CI pull requests use `pull_request`, read-only `GITHUB_TOKEN`, and never receive either signing secret. The workflow does not deploy the website; Vercel's Git integration serves its previews and reviewed production branch.

The release validator compares the package, Cargo, and Tauri versions, then checks that draft metadata points to the release's NSIS installer and embeds the same signature as its `.sig` asset. It does not prove a real in-app upgrade; that requires the coordinator's isolated Windows upgrade check.

# Permanent Firefox installation and releases

The project is **MIT-licensed open source**. Its prepared Mozilla distribution channel is **unlisted**: Mozilla signs the extension for personal/self-distributed installation, without a public AMO store listing. Standard Firefox requires the signed XPI. Local ZIPs are unsigned development/submission packages.

## Prepare the release

Use Node.js 26.13.0 (see `.nvmrc`) and npm 12.2.1 for the recorded build environment.

```sh
npm ci
npm run release
```

The command runs type checking, tests, the build, and Mozilla add-on lint. It produces these files for version 0.3.1:

- `artifacts/comizy-dl-0.3.1.zip`: unsigned extension to submit to Mozilla.
- `artifacts/comizy-dl-0.3.1-sources.zip`: matching reviewer sources and reproducible build instructions.
- `artifacts/SHA256SUMS-0.3.1.txt`: hashes of those two archives.

`npm run package:source` creates only the source archive. That archive uses an allowlist of source/build/doc/test files, excludes dependencies, generated artifacts, hidden credential files and downloaded manga, and refuses symlinked source files.

The stable Firefox ID remains `mangadl-comizy@local.invalid`. Keep it for all updates. The project is open source under the MIT License, included in both extension and reviewer source archives. The bundled fflate library retains its own MIT copyright and license notice. These defaults are recorded in `release/amo-metadata.json`.

## Sign with the Developer Hub

1. Sign in to the [Mozilla Add-ons Developer Hub](https://addons.mozilla.org/developers/) with your Mozilla account. Review and accept Mozilla's developer agreement yourself.
2. Submit a new add-on and choose **On your own** / self-distribution (unlisted).
3. Upload the unsigned extension ZIP and the matching source ZIP. Use `release/REVIEWER_NOTES.md` for reviewer notes and `PRIVACY.md` for the privacy notice. Select MIT if asked for a license.
4. Wait for Mozilla's validation/signing and any requested review. Download the **signed `.xpi`** from that version's page.

No local build command can substitute for Mozilla's signature in standard Firefox. Renaming an unsigned ZIP to XPI does not sign it.

## Optional command-line signing

Obtain your own [AMO API credentials](https://addons.mozilla.org/developers/addon/api/key/) and set `WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret) in your local shell. Keep their values outside this repository and chat; the scripts read them from the environment without placing them in command arguments. No `.env` file is loaded automatically.

Preview without credentials or a network submission:

```sh
npm run sign:unlisted -- --dry-run
```

When you are ready to upload with that account:

```sh
npm run sign:unlisted
```

The real signing command checks credentials, prepares fresh validated release/source archives, submits on the **unlisted** channel with the reviewer sources and metadata, and downloads the signed result into `artifacts/signed/` once Mozilla approves it. The command does not support a listed/public channel. No signing request is made by `npm run release` or the dry run.

If signing waits out or Mozilla requests manual review, check the Developer Hub for the existing submission before retrying the same version. A signing request may already have been accepted. Download approved results there, or bump versions as directed; do not assume a timeout means nothing was uploaded.

## Install the signed extension

1. Finish or pause active jobs and close the existing comizy-dl manager.
2. If using the temporary development add-on, restart Firefox so it unloads. Removal of a temporary add-on can clear its stored jobs/preferences; existing downloaded files remain on disk. A signed permanent installation stores subsequent job history across browser restarts.
3. Open **about:addons**, choose the gear menu → **Install Add-on From File…**, and select the signed XPI. Accept the disclosed site and data permissions.
4. Open comizy-dl from the extensions menu. Verify one chapter and then restart Firefox to confirm the extension remains installed.

The manager must be open for downloads to run. Restart recovery pauses jobs instead of starting network traffic automatically; reopen the manager and choose Resume / retry unfinished. Completed image records are retained, and unfinished CBZ chapters restart.

## Updates

Bump `package.json` and `public/manifest.json` to the same new version, then run `npm install --package-lock-only` and update the release notes. Keep the add-on ID unchanged. Run `npm run release`, have Mozilla sign the new version, and install the new signed XPI over the existing permanent installation.

This release uses **manual updates**. No update server or `update_url` is configured. Add a hosted update manifest later if automatic self-distributed updates are wanted. A future public AMO listing is a separate distribution decision.

## Before submitting

- Check generated artifact names/version and read PRIVACY.md and reviewer notes.
- Verify both folder and CBZ output with a small selected range in Firefox.
- Check permission/data prompts and restart/resume behavior after installing the signed XPI. A real signed-install test can only be completed after Mozilla returns that file.

Sources: [Signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/), [source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/), [web-ext signing](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign), and [built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

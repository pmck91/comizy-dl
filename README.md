# comizy-dl

An MIT-licensed open-source Firefox desktop extension that saves Comizy chapters as page images or one CBZ archive per chapter. Supports the current chapter, individual selections, inclusive ranges, and complete series.

## Build and install

Use **Node.js 26+** and **Firefox desktop 142+**. For a permanent personal installation, follow [RELEASE.md](RELEASE.md) to prepare an **unlisted Mozilla-signed XPI**:

```sh
npm ci
npm run release
```

Release preparation creates the unsigned extension, matching reviewer source archive, and checksums in `artifacts/`. It does not upload or sign anything. Install the resulting Mozilla-signed XPI through **about:addons → gear menu → Install Add-on From File…**. Permanent installations retain the add-on and subsequent stored jobs across Firefox restarts. Downloads pause on restart until explicitly resumed.

For development, run `npm run build`, then open **about:debugging → This Firefox → Load Temporary Add-on** and select `dist/manifest.json`. After moving the project directory, load the manifest from its new path and reopen the manager. `npm run dev` starts a separate Firefox development profile through `web-ext`; use the temporary loader in your regular profile for your existing Comizy session.

Temporary add-ons disappear when Firefox restarts, and removing one may clear stored jobs/preferences. Files already downloaded remain on disk. The internal Firefox add-on ID stays `mangadl-comizy@local.invalid` for update compatibility.

Read [PRIVACY.md](PRIVACY.md) for network and local-storage details. Firefox's install prompt discloses the required browsing-activity and website-content data involved in Comizy requests. The extension has no developer-operated backend or telemetry.

## Download chapters

1. Open a Comizy series or chapter and click the **comizy-dl** toolbar action. Alternatively, paste its URL into the manager.
2. Click **Load source**. A chapter URL loads just that chapter. **Browse all chapters** collects the whole series; a series URL does this immediately.
3. Select chapters, use the inclusive **From / Through** range, or choose **Select all**. Search changes the visible rows while preserving your selections.
4. Choose **Image folders** (default) or **CBZ per chapter**. **Join split pages** is enabled by default. Click **Download selected chapters** and keep the manager tab open.

Files go under Firefox's configured Downloads folder:

```text
comizy-dl/call-of-the-night-fan-colored-colored/
  0001 - Chapter 1 - Reassembled/
    001.png
    002.png
    ...
  0002 - Chapter 2 - Reassembled.cbz
```

Chapter prefixes use the site's reading ordinal, so decimal chapters stay in order. Page filenames follow source order. **Join split pages** reconstructs the confirmed Comizy pattern: a 1500px-high image followed by an 84px-high strip of the same width. It keeps all pixels, including blank margins and artwork in the strips, and writes the joined page as a lossless PNG. Standalone images keep their original bytes and format. Other layouts, missing dimensions, and the two 792px half-page images in Chapter 1 stay separate.

For the inspected Chapter 1, this produces **41 pages from 80 source chunks**: 39 joined pages at 1056×1584 plus two standalone 1056×792 images. Reassembled jobs use a separate ` - Reassembled` folder/archive name so they do not mix with existing raw downloads. Turn off **Join split pages** to save every source image separately with the original naming. CBZ entries are numbered images at the archive root with no extra compression; your reader needs to support PNG and any original formats, including WebP.

The save root is a relative subfolder under Downloads. Change Firefox's Downloads setting to use a different destination. Existing filename conflicts are handled by Firefox's `uniquify` option, so a fresh job can produce additional copies.

## Pause, retry, and recovery

- **Pause** stops image requests and further scheduling. File saves already handed to Firefox can finish.
- Closing the manager pauses the batch. Reopen it with the toolbar action, select a saved job, then choose **Resume / retry unfinished**.
- Completed folder images are recorded individually and skipped on resume. An unfinished CBZ chapter starts again; a completed archive is skipped.
- **Cancel** stops further work and cancels pending file saves. Files already saved remain on disk. Unfinished work can still be resumed from its saved job.
- A chapter with a bad image is reported as failed while the batch continues. A CBZ is saved only if all its images succeeded.
- Access failures pause the batch. Use **Open source page**, resolve any normal site sign-in/access requirement, then resume. Repeated rate limiting also pauses the batch; wait before resuming.

Resume uses the job's completion records. Files deleted or moved after completion are not automatically rediscovered. Create a fresh job to download a chapter again. A job keeps its original output mode, page-reassembly setting, and save root; choose new settings when creating a new job. Jobs created by v0.1 remain raw-image jobs, preserving their existing page numbering and completion records. To reassemble an old chapter, create a new job with **Join split pages** enabled.

## Reassemble an existing downloaded folder

The optional local helper requires **ImageMagick 7** (`magick`) and Node.js 26+. The Firefox extension does not need ImageMagick.

```sh
npm run reassemble -- "/path/to/0001 - Chapter 1" --dry-run
npm run reassemble -- "/path/to/0001 - Chapter 1"
```

The helper uses the same conservative grouping rule as the extension. It creates a sibling folder named `0001 - Chapter 1 - Reassembled`, copies standalone files unchanged, and joins matching pairs as PNGs. It refuses an existing output folder and never modifies the input files. Supply a second folder argument to choose another new destination. A `reassembly.json` file records the output-to-source mapping and SHA-256 hashes.

## How it works

- The reader's `script#__NEXT_DATA__` contains the full image sequence and dimensions in `props.pageProps.initialChapter.pages` / `images`. Chapter 1 supplied 80 image chunks when inspected on 2026-11-08, while its initial HTML displayed only three. The page planner retains every source chunk and pairs only the confirmed matching fragments.
- The series initially supplied only 50 of its advertised 220 chapters. The content script operates on an extension-owned inactive Comizy tab, clears chapter filters, and follows the rendered **Chapter range** and **Load more** controls. It returns a complete list only when the unique chapter count matches the advertised total. A failed discovery leaves its source tab available for inspection; **Cancel loading** closes it.
- Images are fetched in the extension context. A Firefox `webRequest` hook adds `Referer: https://comizy.io/` only to this extension's requests to `*.cmzcdn.org`; the CDN otherwise rejected the test image with HTTP 403. Ordinary page requests are left untouched.
- Downloads run one chapter at a time with up to three image requests in flight. Transient failures get two retries; HTTP `Retry-After` is honored. Requests time out after 30 seconds, with cancellation available during retry waits.
- The background script serializes job metadata updates and Firefox download completion events. Binary image and archive data stays in the manager, limited to the chapter being processed. All dependencies ship inside the extension.

Permissions are `downloads`, `storage`, `webRequest`, `webRequestBlocking`, and host access to `comizy.io` / `*.cmzcdn.org`. No companion program, private API integration, remote extension code, telemetry, or developer-operated backend is used. Requested Comizy/CDN URLs and normal request information are sent to those services as described in PRIVACY.md. V1 targets normal Firefox desktop profiles; private browsing and container-specific sessions are outside its tested scope.

## Development and verification

```sh
npm run typecheck
npm test
npm run test:browser
npm run build
npm run lint:addon
```

The tests cover real minimal chapter metadata, complete discovery through simulated hydration/range/load-more behavior, repeated pages and strips, safe filenames, request-header scoping, response validation, retries, serialized download events, concurrency, partial folder recovery, interrupted file saves, page reassembly, legacy-job compatibility, and complete CBZ output. Fixtures contain metadata and three initial reader image elements, not downloaded image bytes; tests do not contact Comizy.

`npm run test:browser` requires Firefox (`FIREFOX_BINARY` can override its executable). It launches a disposable headless profile and a loopback test server, generates colored source images, and checks real PNG encoding, full-page dimensions, exact pixel order across the join, standalone byte preservation, mismatch rejection, and cancellation. It does not use your browsing profile or contact Comizy.

Source layout:

- `src/comizy.ts`, `collector.ts`, `content.ts`: page adapter and rendered chapter collection.
- `src/network.ts`, `headers.ts`: retrieval, validation, retries, and request headers.
- `src/runner.ts`, `pages.ts`, `compose.ts`, `archive.ts`, `paths.ts`: queue, page grouping, compositing, and output generation.
- `src/background.ts`, `jobs.ts`: browser events, job ownership, helpers, and recovery records.
- `src/manager.ts`, `public/manager.*`: user interface.

### Live Firefox acceptance

Automated checks exercise the application with DOM fixtures, Firefox API mocks, and a real headless Firefox compositor test. These complete-extension checks still need a Firefox desktop session:

1. Load the temporary add-on and open `https://comizy.io/call-of-the-night-fan-colored-colored/chapter-1`.
2. Load the source and download the chapter as folders with **Join split pages** enabled. Confirm 41 numbered pages: 39 full PNG pages and two standalone half-page images. Check the bottom artwork on the second reconstructed page.
3. Download the same chapter as CBZ and compare its 41 entries with the folder output. Turn off reassembly in a new job and confirm the original 80 source chunks are available separately.
4. Load `https://comizy.io/call-of-the-night-fan-colored-colored`. Confirm discovery collects all 220 chapters (or the site's current advertised total), including decimal chapters.
5. Download a small selected range in both formats. Pause and resume; then close the manager during a batch and reopen it. Completed files should be skipped, and an unfinished CBZ chapter should restart.
6. Cancel a batch and confirm completed files remain. Test blocked/offline access and a failed file save; confirm useful failure messages and retry behavior.

The site adapter is intentionally isolated because Comizy can change its embedded metadata, controls, or image hosts. Unexpected layouts or incomplete counts produce an error rather than silently omitting pages or chapters.

## License

comizy-dl is open source under the [MIT License](LICENSE). You may use, modify, and redistribute it under those terms. Release archives include the license. The bundled fflate dependency retains its own MIT copyright and license notice in `fflate-LICENSE.txt`.

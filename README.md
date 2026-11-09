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

1. Open a Comizy series or chapter and click the **comizy-dl** toolbar action. Reader URLs can use volume, bonus, or oneshot slugs; they do not have to start with `chapter-`. Alternatively, paste its URL into the manager.
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

Chapter prefixes use the site's reading ordinal, so decimal chapters stay in order. Page filenames follow source order. **Join split pages** first downloads one chapter's source images, measures their actual decoded dimensions, and learns repeated main-image heights and strip proportions within that chapter. It then joins matching adjacent pieces of the same width, preserving every pixel as a lossless PNG. There is no list of fixed pixel heights. Incorrect or missing reader dimensions do not control the analysis. Standalone images keep their original bytes and format; half pages and ambiguous layouts stay separate. The chapter's progress row shows how many pages were joined and whether possible joins were left separate.

For the inspected Chapter 1, this produces **41 pages from 80 source chunks**: 39 joined pages at 1056×1584 plus two standalone 1056×792 images. Reassembled jobs use a separate ` - Reassembled` folder/archive name so they do not mix with existing raw downloads. Turn off **Join split pages** to save every source image separately with the original naming. CBZ entries are numbered images at the archive root with no extra compression; your reader needs to support PNG and any original formats, including WebP.

The save root is a relative subfolder under Downloads. Change Firefox's Downloads setting to use a different destination. Existing filename conflicts are handled by Firefox's `uniquify` option, so a fresh job can produce additional copies.

## Pause, retry, and recovery

- **Pause** stops image requests and further scheduling. File saves already handed to Firefox can finish.
- Closing the manager pauses the batch. Reopen it with the toolbar action, select a saved job, then choose **Resume / retry unfinished**.
- Completed folder images are recorded individually and skipped on resume. An unfinished CBZ chapter starts again; a completed archive is skipped.
- **Cancel** stops further work and cancels pending file saves. Files already saved remain on disk. Unfinished work can still be resumed from its saved job.
- A chapter with a bad image is reported as failed while the batch continues. A CBZ is saved only if all its images succeeded.
- Access failures pause the batch. Use **Open source page**, resolve any normal site sign-in/access requirement, then resume. Repeated rate limiting also pauses the batch; wait before resuming.

Resume uses the job's completion records. Files deleted or moved after completion are not automatically rediscovered. Create a fresh job to download a chapter again. Automatic analysis saves its chosen page grouping before writing any output. Resuming reuses that layout, skips completed folder pages and their image requests, and rejects a changed source list. Pausing before analysis finishes restarts that chapter's unsaved image requests. An unfinished reassembled folder from a release before v0.4 has no saved layout; create a new job or use the offline helper to avoid mixing page numbers.

A job keeps its original output mode, page-reassembly setting, and save root; choose new settings when creating a new job. Jobs created by v0.1 remain raw-image jobs, preserving their existing page numbering and completion records. To reassemble an old chapter, create a new job with **Join split pages** enabled.

## Reassemble existing downloads

The optional local helper requires **ImageMagick 7** (`magick`) and Node.js 26+. The Firefox extension does not need ImageMagick.

```sh
npm run reassemble -- "/path/to/0001 - Chapter 1" --dry-run
npm run reassemble -- "/path/to/0001 - Chapter 1"
```

The helper uses the same chapter-based inference as the extension. It creates a sibling folder named `0001 - Chapter 1 - Reassembled`, copies standalone files unchanged, and joins matching pairs as PNGs. It refuses an existing output folder and never modifies the input files. Supply a second folder argument to choose another new destination. A `reassembly.json` file records the output-to-source mapping and SHA-256 hashes.

For a CBZ file or a folder containing chapter CBZs:

```sh
npm run reassemble:cbz -- "/path/to/Call of the Night" --dry-run
npm run reassemble:cbz -- "/path/to/Call of the Night"
npm run reassemble:cbz -- "/path/to/chapter.cbz" "/path/to/new-chapter.cbz"
```

This creates a new sibling ` - Reassembled` folder or CBZ and refuses an existing destination. It keeps the original archives, sorts numbered source images in reading order, preserves non-image entries such as `ComicInfo.xml`, and copies archives that need no joins byte for byte. Each joined PNG is independently decoded and compared with all source pixels. A JSON report records source/output hashes, page mappings, and pixel verification hashes. No network access is needed. An interrupted batch leaves completed copies and its report in the new folder; choose a fresh destination for another run.

On the inspected 220-CBZ collection, 189 chapters needed 3,334 joins; the other 31 archives were already complete. Chapter 2 becomes 24 pages from 48 chunks; Chapter 3 also becomes 24 pages, including its landscape illustrations. The adaptive planner reproduces all these joins without a size list. Dimensions alone cannot prove every page boundary: isolated pairs, conflicting cuts, and weak patterns stay separate. In particular, a chapter with only one main/strip pair lacks repeated evidence and is retained unchanged.

## How it works

- The reader's `script#__NEXT_DATA__` contains the full image sequence and dimensions in `props.pageProps.initialChapter.pages` / `images`. Chapter 1 supplied 80 image chunks when inspected on 2026-11-08, while its initial HTML displayed only three. The page planner retains every source chunk. Chapter 1's 84px strips are only one pattern; later chapters use 100px, 56px, 58px, and 548px tails. Downloaded image dimensions, rather than these example sizes or the reader metadata, drive the inference.
- The series initially supplied only 50 of its advertised 220 chapters. The manager owns discovery and communicates directly with a content script in an extension-owned inactive Comizy tab, clears chapter filters, and follows the rendered **Chapter range** and **Load more** controls. It accepts a list only when every expected unique chapter is present. If the site exposes exhaustive contiguous chapter ranges that disagree with its headline count, those explicit ranges define coverage and the manager shows both counts. For example, Nights With a Cat exposes 258 entries numbered 4–261 while its headline says 261. One Punch Man likewise exposes 500 entries numbered 4–503; all 19 volume, bonus, and oneshot links are included. The initial 50-chapter subset remains incomplete. A failed discovery leaves its source tab available for inspection; **Cancel loading** closes it.
- Images are fetched in the extension context. A Firefox `webRequest` hook adds `Referer: https://comizy.io/` only to this extension's requests to `*.cmzcdn.org`; the CDN otherwise rejected the test image with HTTP 403. Ordinary page requests are left untouched.
- With page joining enabled, one chapter's compressed originals are held in the manager while actual dimensions are measured. Decoded bitmaps close immediately. The planner looks for same-width adjacent pieces with a clear height difference, then requires repeated main heights or strip proportions. It uses relative confidence thresholds, not absolute pixel sizes. Competing boundaries remain separate; blankness is never a reason to discard an image. The chosen layout and dimensions are stored locally before saves, and compressed originals are released as output pages are generated. With joining disabled, raw images retain the original streaming behavior.
- Downloads run one chapter at a time with up to three image requests in flight. Transient failures get two retries; HTTP `Retry-After` is honored. Requests time out after 30 seconds, with cancellation available during retry waits.
- The background script serializes job metadata updates and Firefox download completion events. Binary image and archive data stays in the manager, limited to the chapter being processed. All dependencies ship inside the extension.

Permissions are `downloads`, `storage`, `webRequest`, `webRequestBlocking`, and host access to `comizy.io` / `*.cmzcdn.org`. No companion program, private API integration, remote extension code, telemetry, or developer-operated backend is used. Requested Comizy/CDN URLs and normal request information are sent to those services as described in PRIVACY.md. V1 targets normal Firefox desktop profiles; private browsing and container-specific sessions are outside its tested scope.

## Development and verification

```sh
npm run typecheck
npm test
npm run test:browser
npm run test:reassemble  # optional; requires ImageMagick 7
npm run build
npm run lint:addon
```

The tests cover real minimal chapter metadata, reader URLs with volume/bonus/oneshot slugs, complete discovery through simulated hydration/range/load-more behavior, repeated pages and strips, safe filenames, request-header scoping, response validation, retries, serialized download events, concurrency, partial folder recovery, interrupted file saves, page reassembly, legacy-job compatibility, and complete CBZ output. Fixtures contain metadata and three initial reader image elements, not downloaded image bytes; tests do not contact Comizy.

`npm run test:browser` requires Firefox (`FIREFOX_BINARY` can override its executable). It launches a disposable headless profile and a loopback test server, generates colored source images, and checks downloaded dimensions, learned grouping at unfamiliar sizes, PNG output dimensions and every decoded pixel, standalone byte preservation, mismatch rejection, and cancellation. It does not use your browsing profile or contact Comizy.

Source layout:

- `src/comizy.ts`, `collector.ts`, `content.ts`: page adapter and rendered chapter collection.
- `src/network.ts`, `headers.ts`: retrieval, validation, retries, and request headers.
- `src/runner.ts`, `prepare.ts`, `pages.ts`, `compose.ts`, `archive.ts`, `paths.ts`: queue, page grouping, compositing, and output generation.
- `src/background.ts`, `jobs.ts`: browser events, job ownership, helpers, and recovery records.
- `src/manager.ts`, `public/manager.*`: user interface.

### Live Firefox acceptance

Automated checks exercise the application with DOM fixtures, Firefox API mocks, and a real headless Firefox compositor test. These complete-extension checks still need a Firefox desktop session:

1. Load the temporary add-on and open `https://comizy.io/call-of-the-night-fan-colored-colored/chapter-1`.
2. Load the source and download the chapter as folders with **Join split pages** enabled. Confirm 41 numbered pages: 39 full PNG pages and two standalone half-page images. Check the bottom artwork on the second reconstructed page.
3. Download the same chapter as CBZ and compare its 41 entries with the folder output. Turn off reassembly in a new job and confirm the original 80 source chunks are available separately.
4. Check Chapters 2 and 3 with Join split pages enabled: each should have 24 pages, including joined landscape pages in Chapter 3. Load `https://comizy.io/call-of-the-night-fan-colored-colored`. Confirm discovery collects all 220 chapters (or the site's current advertised total), including decimal chapters.
5. Download a small selected range in both formats. Pause and resume; then close the manager during a batch and reopen it. Completed files should be skipped, and an unfinished CBZ chapter should restart.
6. Load `https://comizy.io/one-punch-man`. Confirm all available chapters are collected, including the volume, bonus, and oneshot entries whose reader URLs do not start with `chapter-`. On the inspected page, the list has 500 entries and Comizy's counter is 503. Paste a bonus reader URL directly and confirm its image list loads.
7. Cancel a batch and confirm completed files remain. Test blocked/offline access and a failed file save; confirm useful failure messages and retry behavior.

The site adapter is intentionally isolated because Comizy can change its embedded metadata, controls, or image hosts. Incomplete metadata or chapter counts produce an error rather than silently omitting pages or chapters. Uncertain image boundaries stay separate.

### Inference thresholds

Only adjacent, equally wide images with valid decoded dimensions are candidates. A potential strip must be less than half the main image's height; strips at most one quarter of the main height provide initial evidence. At least two candidate pairs must share a main height within 2%, or two thin-strip pairs must share a strip/main proportion within 8%. Supported main heights also allow larger remaining pieces under the half-height limit. These are relative confidence thresholds and do not contain site-specific pixel heights. Overlapping candidate boundaries are left separate. Raw output remains available by turning off Join split pages.

## License

comizy-dl is open source under the [MIT License](LICENSE). You may use, modify, and redistribute it under those terms. Release archives include the license. The bundled fflate dependency retains its own MIT copyright and license notice in `fflate-LICENSE.txt`.

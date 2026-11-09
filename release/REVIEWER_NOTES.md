# Reviewer notes: comizy-dl

## Intended distribution and identity

This release is for unlisted self-distribution/personal use on Firefox desktop 142+. The stable ID `mangadl-comizy@local.invalid` predates the comizy-dl rename and is intentionally retained for updates and local storage continuity. It is an opaque extension identifier, not an email account or network endpoint. The project and submission are MIT-licensed open source. LICENSE is included in the source and compiled extension archives; fflate retains its own MIT notice.

## Behavior and permissions

- `downloads`: save original or reassembled page images and locally generated CBZ files under Firefox's Downloads directory, and track file completion.
- `storage`: retain settings and job/file completion records locally. Session storage holds manager/helper tab IDs.
- `webRequest` and `webRequestBlocking`: set a fixed `Referer: https://comizy.io/` only on extension-originated image fetches to `*.cmzcdn.org`. Requests from normal website documents are not rewritten. This header is required by the site's image servers.
- Host access to `https://comizy.io/*`: parse reader HTML and operate the rendered chapter list in an extension-owned inactive tab.
- Host access to `https://*.cmzcdn.org/*`: fetch chapter image bytes from the site's CDN.
- Required `browsingActivity` and `websiteContent`: Firefox's installation consent discloses requested Comizy URLs, request/response information, and the browser's normal destination-cookie handling. There is no developer endpoint or telemetry. See PRIVACY.md and the manager's Privacy link.

There is no native application, remote extension code, private API client, telemetry, or automatic startup download. An inactive Comizy page runs the site's own scripts, including any ads; the extension does not inject those scripts. The manager must remain open while work is running. It owns the long-running chapter scan and talks directly to the content script; short background calls only create/register and clean up helper tabs, allowing the background event page to suspend safely. Restarting Firefox pauses previously active jobs and preserves completed file records for an explicit user resume.

Page images and metadata are data. HTML is parsed without evaluating its scripts. For rendered discovery the add-on uses the site's existing chapter controls and requires the unique chapter count and ordinals to cover the complete expected list. If explicit contiguous range controls prove a smaller available list than the headline counter, that list defines coverage and both counts are displayed. Page reassembly downloads and measures one chapter's images locally, then infers same-width main/strip pairs from repeated heights and proportions. No absolute pixel-height list is used. Relative confidence thresholds and adjacent-piece checks retain ambiguous or overlapping cuts separately. All source pixels are retained, and standalone files keep their original bytes. The layout is saved before any output to stabilize resume numbering; resumes skip completed folder pages and their image requests. See README.md for the inference thresholds. An unfinished reassembled folder from a release before v0.4 must use a new job or the optional offline helper because it lacks a persisted layout.

## Functional test

No test account is supplied or needed for the public pages used during development. Comizy availability and normal sign-in/access behavior are external to the extension.

1. Install the add-on, grant its disclosed permissions, open its toolbar action, and load `https://comizy.io/call-of-the-night-fan-colored-colored/chapter-1`.
2. Choose Image folders with Join split pages enabled. On the inspected source, Chapter 1 becomes 41 images (39 PNG joins and two original half pages), with no artwork discarded.
3. Also check Chapters 2 and 3: each becomes 24 pages, with landscape joins preserved in Chapter 3. Create another job with CBZ output and confirm the same ordered images are at the archive root. Turn off Join split pages to retain all 80 original source chunks.
4. Load the series URL without `/chapter-1`; select a short range. Rendered discovery must cover the full expected list before returning. Explicit exhaustive site ranges can supersede a stale headline count; both counts are then shown.
5. Pause/resume, cancel, close/reopen the manager, and restart Firefox during a job. Completed files remain on disk; the next manager session offers explicit resume. Incomplete CBZ chapters restart.
6. Load `https://comizy.io/one-punch-man` and confirm discovery includes its volume, bonus, and oneshot links. Reader slugs are validated as safe path segments rather than requiring a `chapter-` prefix, and returned reader metadata must match the requested URL. The inspected list contains 500 available entries numbered 4–503, while the headline counter says 503.
7. Revoke site permissions or go offline to verify a visible error and no silent partial CBZ output.

The source archive includes automated extraction, grouping, request validation, job serialization, restart, and packaging tests. See BUILD.md for reproduction.

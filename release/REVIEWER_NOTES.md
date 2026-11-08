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

There is no native application, remote extension code, private API client, telemetry, or automatic startup download. An inactive Comizy page runs the site's own scripts, including any ads; the extension does not inject those scripts. The manager must remain open while work is running. Restarting Firefox pauses previously active jobs and preserves completed file records for an explicit user resume.

Page images and metadata are data. HTML is parsed without evaluating its scripts. For rendered discovery the add-on uses the site's existing chapter controls and requires the unique count to equal the advertised total. Page reassembly only joins the confirmed same-width 1500px + 84px pattern and preserves standalone images.

## Functional test

No test account is supplied or needed for the public pages used during development. Comizy availability and normal sign-in/access behavior are external to the extension.

1. Install the add-on, grant its disclosed permissions, open its toolbar action, and load `https://comizy.io/call-of-the-night-fan-colored-colored/chapter-1`.
2. Choose Image folders with Join split pages enabled. On the inspected source, Chapter 1 becomes 41 images (39 PNG joins and two original half pages), with no artwork discarded.
3. Create another job with CBZ output and confirm the same ordered images are at the archive root. Turn off Join split pages to retain all 80 original source chunks.
4. Load the series URL without `/chapter-1`; select a short range. Rendered discovery must collect the full advertised total before Select all is available.
5. Pause/resume, cancel, close/reopen the manager, and restart Firefox during a job. Completed files remain on disk; the next manager session offers explicit resume. Incomplete CBZ chapters restart.
6. Revoke site permissions or go offline to verify a visible error and no silent partial CBZ output.

The source archive includes automated extraction, grouping, request validation, job serialization, restart, and packaging tests. See BUILD.md for reproduction.

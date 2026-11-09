# comizy-dl privacy notice

Effective version: 0.4.0. Prepared on 2026-11-09.

comizy-dl loads and downloads only the Comizy series, chapters, and images the user requests. Direct extension requests go to `https://comizy.io` and `https://*.cmzcdn.org`. These services receive the requested URLs and normal connection information such as IP address and browser headers. Existing destination cookies may be included by Firefox. The add-on sets `Referer: https://comizy.io/` on its own image requests.

Rendered chapter discovery opens an inactive Comizy tab. The page executes the site's normal scripts and can contact services selected by Comizy, including advertising providers. This page behavior is subject to the site's practices and the user's browser settings. The extension does not inject advertising or analytics code.

Job history, chapter selections, output preferences, measured image dimensions and page groupings, completion records, and browser download IDs are stored locally in the add-on's Firefox storage. Files are saved to the user's configured Downloads directory. Page compositing and CBZ generation happen locally. Removing the add-on normally removes its stored records, but does not delete previously downloaded files.

The extension has no developer-operated backend, analytics, telemetry, or remote image-processing service. It does not upload job history or downloaded image contents to the developer or a processing service. Normal requests to Comizy and its image servers remain necessary to provide the requested downloads.

The manifest declares required `browsingActivity` and `websiteContent` data permissions so Firefox discloses those network interactions during installation. No optional data collection is implemented. Users can decline installation, pause/cancel downloads, close the manager, revoke site access, or remove the add-on using Firefox's Add-ons Manager.

The code processes Comizy's rendered chapter lists and embedded metadata. No private API integration or execution of remote extension code is used. comizy-dl is independent of Comizy and Mozilla.

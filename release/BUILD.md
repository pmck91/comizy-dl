# Reviewer build instructions

This archive is the human-readable source for comizy-dl 0.3.1, an unlisted Firefox desktop extension. It uses TypeScript, esbuild, and the unmodified npm release of fflate. No code is fetched from a website at extension runtime.

## Environment

The release was prepared on Linux x86_64 with Node.js **26.13.0** and npm **12.2.1**. `.nvmrc` specifies Node 26.13.0. Node.js 26+ is required; Mozilla's default Node 24 environment must be upgraded for this build. Firefox desktop 142+ is the runtime target.

## Reproduce the installed files

Extract the source archive into a clean directory, then run:

```sh
npm ci
npm run build
```

`dist/` contains the exact unsigned extension files. Compare those files with the extension ZIP, ignoring ZIP timestamps and Mozilla's signatures added after submission. esbuild emits readable, unminified bundles and external source maps. The fflate license is copied from its locked npm dependency to `dist/fflate-LICENSE.txt`; privacy documentation is copied to `dist/PRIVACY.md`, and the project MIT license is copied to `dist/LICENSE`.

All dependencies come from the official npm registry through the included `package-lock.json`. Do not use `npm update`. The build does not need Firefox, ImageMagick, AMO credentials, access to Comizy, or access to any private API.

## Additional validation

```sh
npm run typecheck
npm test
npm run lint:addon
```

`npm run test:browser` additionally requires Firefox, starts an isolated headless profile and loopback server, and checks generated compositor pixels. It does not use a normal browsing profile or contact Comizy. The optional offline repair helper requires ImageMagick 7; neither building nor running the extension requires ImageMagick.

`npm run release` runs checks and writes unsigned extension and source ZIPs plus SHA-256 checksums. It makes no Mozilla submission. `npm run sign:unlisted -- --dry-run` displays the planned signing command without reading credentials or contacting AMO.

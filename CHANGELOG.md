# Changelog

## 1.0.0-public

- Published a sanitized, source-first repository for the Chromium extension.
- Kept the loadable `extension/` tree and fixed extension ID from the working
  move-safe package; added the declared `management` permission required by its
  existing self-uninstall call.
- Included the native bridge and the audited upstream source needed for review.
- Excluded account credentials, JWTs, logs, caches, network snapshots, Python caches,
  prebuilt runtimes, platform binaries and the original upload archive.
- Added public-repository security, privacy, dependency and CI documentation.

## 1.0.0 (working package)

- Extension version locked to 1.0.0.
- Native host cleanup covers Chrome, Edge and Chromium registrations.
- Cleanup restores the browser proxy to DIRECT before removing local components.

# Changelog

## 1.0.0-public

- Published a sanitized, source-first repository for the Chromium extension.
- Kept the loadable `extension/` tree byte-identical to the working move-safe package.
- Included the native bridge and the audited upstream source needed for review.
- Excluded account credentials, JWTs, logs, caches, network snapshots, Python caches,
  prebuilt runtimes, platform binaries and the original upload archive.
- Added public-repository security, privacy, dependency and CI documentation.

## 1.0.0 (working package)

- Extension version locked to 1.0.0.
- Native host cleanup covers Chrome, Edge and Chromium registrations.
- Cleanup restores the browser proxy to DIRECT before removing local components.

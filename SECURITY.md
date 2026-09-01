# Security policy

## Scope

This project is an unofficial prototype that reads a user's own Firefox IP
Protection session state through a local native host. It is not a Mozilla,
Google or Fastly product.

## Do not publish credentials

Never commit or paste any of the following into an issue, pull request, log or
support message:

- Firefox Account session or renewal credentials;
- ProxyPass JWTs, OAuth access tokens or cookies;
- proxy listener passwords or API keys;
- browser profile exports, screenshots or local installation logs.

The public tree intentionally excludes `runtime/`, token files, generated data,
logs, archives and binaries. The repository's audit script and CI check enforce
those exclusions, but a clean review is still required before every release.

If a credential was ever placed in a shared archive or repository, assume it is
compromised: revoke the Firefox session, rotate related credentials, remove all
copies and inspect the complete Git history. Deleting the current file alone is
not sufficient after a push.

## Reporting

Please report security issues privately to the repository owner rather than
including secret material in a public issue. Redact tokens and use a synthetic
example when reproducing a problem.

## Release requirements

A Windows runtime or installer must be built separately from this source tree,
scanned for secrets, supplied with complete third-party notices, and reviewed
for its Native Messaging registry and proxy-cleanup side effects before it is
published as a release artifact.

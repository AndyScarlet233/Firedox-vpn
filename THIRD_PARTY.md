# Third-party notices

This repository contains source plus the small extension image assets needed
for the unpacked extension. It does **not** include the private Python
distribution, wheels, compiled extensions, PyInstaller output, or other runtime
binaries from the working package.

## Upstream source

The `vendor/firefox-ip-protection-pool/` directory contains the upstream-derived
bridge backend supplied with the original project snapshot:

- Repository: <https://github.com/multi-zhangyang/firefox-ip-protection-pool>
- License: MIT (see `vendor/firefox-ip-protection-pool/LICENSE`)
- The original snapshot did not record an immutable upstream commit. Treat the
  provenance as unpinned until a release process records and verifies one.

## Python dependencies

The backend declares `requests` and `PyFxA` in
`vendor/firefox-ip-protection-pool/requirements.txt`. Their transitive packages
and licenses must be resolved and recorded in a release SBOM; they are not
vendored or redistributed here.

## Names and services

Firefox, Mozilla, Firefox IP Protection, Fastly and related marks/services are
referenced only to describe interoperability. This project is unofficial and
has no endorsement or affiliation with their owners. Users are responsible for
service eligibility, terms-of-use and applicable law.

## Release artifact rule

Any future Windows runtime must ship its own complete dependency notices and
license texts. Do not copy `runtime/packages`, `runtime/vpn_bridge_host.exe`, or
an installed runtime into this repository.

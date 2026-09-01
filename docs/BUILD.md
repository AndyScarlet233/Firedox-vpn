# Build and release boundary

The public repository intentionally does not contain the installed Windows
runtime. The original working package mixed a PyInstaller executable, a private
Python environment, downloaded node data, machine-specific paths, logs and
Firefox credentials. Reusing that directory as a public release would be unsafe
and would not be reproducible.

## What a future release build must do

1. Pin the upstream backend to an immutable commit and record the source hash.
2. Build a fresh 64-bit Windows runtime from reviewed source with a supported
   Python/uv version and a dependency lock or hashes.
3. Generate the Native Messaging manifest at install time with the actual
   runtime path and the fixed extension ID.
4. Keep credentials in a per-user private directory; never copy them from the
   source tree or include them in logs, diagnostics or artifacts.
5. Register only the browser chosen by the user and restore only settings owned
   by the extension. It must not reset global WinHTTP proxy state or terminate
   unrelated processes by image name.
6. Run the public-tree audit, a binary secret scan, dependency/license review,
   SBOM generation and clean Windows smoke tests before signing an artifact.

Until those steps are implemented and reviewed, this repository should be used
for source review and loading the unpacked extension only. Do not advertise it
as a standalone VPN installer.

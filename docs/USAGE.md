# Using the sanitized source checkout

The unpacked extension can be loaded without placing any credentials in this
repository:

1. Open the browser's extensions page.
2. Enable developer mode.
3. Choose **Load unpacked** and select this checkout's `extension/` directory.
4. If a compatible Native Messaging host is already registered for the same
   extension ID, the bridge can continue to be used. Otherwise only the UI is
   available until a separately built and audited host is installed.

Never copy a private `runtime/` directory, a Firefox profile export, a token
file, or an installed `vpn_bridge_host.exe` into the checkout. Keep those files
outside Git and use the source/release process described in [`BUILD.md`](BUILD.md).

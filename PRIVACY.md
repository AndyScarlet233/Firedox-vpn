# Privacy and data flow

This prototype has no analytics or telemetry code in the published source. It
still handles sensitive data because it is a local VPN bridge.

## Data handled locally

- The extension stores routing and preference settings in Chrome extension
  storage.
- The popup reads the active HTTP(S) tab hostname to show and edit a route rule.
- The native host scans the local Firefox profiles and, when the user explicitly
  chooses **从 Firefox 导入**, selects the most recently modified verified
  `signedInUser.json` record.
- Renewal credentials, short-lived proxy authorization material, node metadata,
  and operational state are written under the separately installed local runtime.
  They are not part of this repository.

## Network destinations

The bridge communicates with Mozilla Firefox Account/Guardian endpoints and the
Firefox Remote Settings endpoint used by the upstream pool. Proxied browser
traffic is forwarded through the selected and potentially rotated Firefox IP
Protection/Fastly exits.
Review the upstream service terms and eligibility requirements before use.

## Browser permissions

The Manifest V3 extension requests `proxy`, `nativeMessaging`, `storage`,
`privacy`, `declarativeNetRequestWithHostAccess`, `contentSettings`, `scripting`,
`activeTab`, `management` and all-URL host access.
They are used to control route-scoped proxy/DNS/WebRTC settings, communicate
with the local bridge, inspect the active page, and apply the optional region
privacy shim. The content scripts run at document start in isolated and main
worlds, which is a high-trust design and should be reviewed before installation.

The source does not promise anonymity, complete VPN coverage, or protection
against a malicious browser, operating system, extension, upstream service, or
compromised build artifact.

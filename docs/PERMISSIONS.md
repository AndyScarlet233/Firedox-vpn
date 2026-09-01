# Permission review

The extension's Manifest V3 permissions are intentionally recorded here because
this is a high-trust browser component.

| Permission | Use in this prototype |
|---|---|
| `proxy` | Install a route-scoped PAC script and restore DIRECT on stop/failure. |
| `nativeMessaging` | Talk to the local bridge; the bridge owns credential handling. |
| `storage` | Store routing and preference settings. |
| `privacy` | Apply or clear WebRTC and legacy network privacy settings. |
| `declarativeNetRequestWithHostAccess` | Add route-scoped DNS prefetch response-header rules. |
| `contentSettings` | Block precise geolocation while region protection is active. |
| `scripting` | Run the page diagnostic in the active HTTP(S) tab. |
| `activeTab` | Read the active tab hostname for a site-specific route rule. |
| `<all_urls>` host access | Apply route and optional region-shield behavior to web pages. |

The two content scripts run at document start in all frames. One stays in an
isolated world and one patches selected page-visible locale, time-zone and font
APIs in the main world. This design can affect web compatibility and should be
reviewed as carefully as any other extension with main-world code.

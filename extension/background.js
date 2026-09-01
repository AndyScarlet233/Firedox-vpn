const HOST_NAME = "org.firefox_ip_protection.chrome_bridge";
const PROXY_HOST = "127.0.0.1";
const PROXY_PORT = 1090;
const DEFAULT_STATE = {
  autoConnect: false,
  webRtcLeakProtection: true,
  dnsPredictionProtection: true,
  regionShieldEnabled: true,
  country: "REC",
  proxyMode: "allowlist",
  allowlist: [],
  bypassSites: [],
  lastError: "",
  runtimeStateSchema: 1
};

// Some services are not a single hostname. Their page, API, images and media
// live on several vendor-owned domains. A user-facing "site bypass" should
// therefore bypass the whole first-party site family, not only www.example.com.
// Keep this list conservative: shared third-party CDNs are excluded unless the
// hostname is clearly dedicated to the service.
const SITE_FAMILIES = {
  // Core first-party domains used by ChatGPT. Third-party analytics/payment/CDN
  // providers are intentionally not included.
  "chatgpt.com": [
    "chatgpt.com",
    "openai.com",
    "oaistatic.com",
    "oaiusercontent.com",
    "oaistatsig.com",
    "openaimerge.com"
  ],
  // Anthropic documents these domains as Claude/Anthropic service endpoints.
  "claude.ai": [
    "claude.ai",
    "claude.com",
    "anthropic.com"
  ],
  "bilibili.com": [
    "bilibili.com",
    "biliapi.com",
    "biliapi.net",
    "biliimg.com",
    "bilicdn1.com",
    "bilivideo.com",
    "bilivideo.cn",
    "bilivideo.net",
    "bilibilivideo.com",
    "hdslb.com",
    "hdslb.net",
    "acg.tv",
    "acgvideo.com",
    "b23.tv",
    "bigfun.cn",
    "bigfunapp.cn",
    "biligame.cn",
    "biligame.com",
    "biligame.net",
    "bilibili.tv",
    "bilibili.co",
    "bilicomic.com",
    "bilicomics.com",
    "im9.com",
    "smtcdns.net",
    "upos-hz-mirrorakam.akamaized.net"
  ]
};

const SITE_FAMILY_ALIASES = {
  "www.bilibili.com": "bilibili.com",
  "chat.openai.com": "chatgpt.com",
  "www.chatgpt.com": "chatgpt.com",
  "claude.com": "claude.ai",
  "www.claude.com": "claude.ai",
  "www.claude.ai": "claude.ai"
};

function normalizeProxyMode(value) {
  if (value === "blacklist" || value === "all") return "blacklist";
  return "allowlist";
}

let nativePort = null;
let nextRequestId = 1;
const pending = new Map();

function translateBridgeError(message = "") {
  const text = String(message || "").trim();
  if (!text) return "";
  const replacements = [
    [/Specified native messaging host not found\.?/i, "未找到本地桥接程序。请运行 INSTALL-OR-REPAIR.cmd 修复本地桥接；修复后扩展目录可以移动或改名。"],
    [/Access to the specified native messaging host is forbidden\.?/i, "Chrome 无权访问本地桥接程序。请确认扩展已由当前安装脚本注册。"],
    [/Native host has exited\.?/i, "本地桥接程序已退出。"],
    [/Native bridge returned no response/i, "本地桥接程序没有返回结果。"],
    [/Native bridge timeout while running (.+)/i, (_, cmd) => `本地桥接程序执行 ${cmd} 时超时。`],
    [/Native bridge disconnected/i, "本地桥接程序已断开连接。"],
    [/Chrome proxy is controlled by another extension or policy\.?/i, "Chrome 代理正被其他扩展或管理员策略控制。"]
  ];
  for (const [pattern, replacement] of replacements) {
    const match = text.match(pattern);
    if (match) return typeof replacement === "function" ? replacement(...match) : replacement;
  }
  return text
    .replace(/\bNative bridge\b/g, "本地桥接程序")
    .replace(/\bhelper\b/gi, "桥接程序")
    .replace(/\bFirefox IP Protection\b/g, "Firefox IP 保护");
}

function normalizeDomain(input) {
  let value = String(input || "").trim().toLowerCase();
  if (!value) throw new Error("请输入网站域名。");
  value = value.replace(/^\*\./, "").replace(/^\.+|\.+$/g, "");
  try {
    if (value.includes("://") || value.includes("/") || value.includes(":") || value.includes("?")) {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      value = url.hostname.toLowerCase().replace(/^\.+|\.+$/g, "");
    } else {
      const url = new URL(`https://${value}`);
      value = url.hostname.toLowerCase().replace(/^\.+|\.+$/g, "");
    }
  } catch (_) {
    throw new Error("这个网站地址看起来无效。");
  }
  if (!value || value.length > 253 || value.includes(" ")) throw new Error("这个网站地址看起来无效。");
  return value;
}

function normalizeDomainArray(values) {
  const result = [];
  for (const item of Array.isArray(values) ? values : []) {
    try {
      const domain = normalizeDomain(item);
      if (!result.includes(domain)) result.push(domain);
    } catch (_) {}
  }
  return result.sort();
}

function canonicalManagedDomain(input) {
  const domain = normalizeDomain(input);
  return SITE_FAMILY_ALIASES[domain] || domain;
}

function normalizeManagedDomainArray(values) {
  const result = [];
  for (const item of Array.isArray(values) ? values : []) {
    try {
      const domain = canonicalManagedDomain(item);
      if (!result.includes(domain)) result.push(domain);
    } catch (_) {}
  }
  return result.sort();
}

function expandRouteDomains(values) {
  const managed = normalizeManagedDomainArray(values);
  const expanded = new Set(managed);
  for (const rule of managed) {
    const family = SITE_FAMILIES[rule];
    if (family) for (const domain of family) expanded.add(domain);
  }
  return [...expanded].sort();
}

function routeUsesVpnForState(state, hostInput) {
  let host = "";
  try { host = normalizeDomain(hostInput); } catch (_) { return false; }
  const mode = normalizeProxyMode(state.proxyMode);
  const routed = mode === "allowlist" ? state.allowlist : state.bypassSites;
  const matched = listCoversHost(expandRouteDomains(routed), host);
  return mode === "allowlist" ? matched : !matched;
}

function hostnameFromUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.hostname.toLowerCase();
  } catch (_) { return ""; }
}

function ruleCoversHost(rule, host) {
  return host === rule || host.endsWith(`.${rule}`);
}

function listCoversHost(list, host) {
  return normalizeDomainArray(list).some((rule) => ruleCoversHost(rule, host));
}

async function getStoredState() {
  const [data, runtime] = await Promise.all([
    chrome.storage.local.get(DEFAULT_STATE),
    chrome.storage.session.get({ enabled: false, resolvedCountry: "" })
  ]);
  return {
    enabled: Boolean(runtime.enabled),
    autoConnect: Boolean(data.autoConnect),
    webRtcLeakProtection: data.webRtcLeakProtection !== false,
    dnsPredictionProtection: data.dnsPredictionProtection !== false,
    regionShieldEnabled: data.regionShieldEnabled !== false,
    resolvedCountry: String(runtime.resolvedCountry || ""),
    country: data.country || "REC",
    proxyMode: normalizeProxyMode(data.proxyMode),
    allowlist: normalizeManagedDomainArray(data.allowlist),
    bypassSites: normalizeManagedDomainArray(data.bypassSites),
    lastError: String(data.lastError || "")
  };
}

async function saveState(patch) {
  const persistent = { ...patch };
  const sessionPatch = {};
  if (Object.prototype.hasOwnProperty.call(persistent, "enabled")) {
    sessionPatch.enabled = Boolean(persistent.enabled);
    delete persistent.enabled;
  }
  if (Object.prototype.hasOwnProperty.call(persistent, "resolvedCountry")) {
    sessionPatch.resolvedCountry = String(persistent.resolvedCountry || "");
    delete persistent.resolvedCountry;
  }
  if (Object.keys(sessionPatch).length) await chrome.storage.session.set(sessionPatch);
  if (Object.keys(persistent).length) await chrome.storage.local.set(persistent);
}

function connectNative() {
  if (nativePort) return Promise.resolve(nativePort);
  return new Promise((resolve, reject) => {
    try {
      const port = chrome.runtime.connectNative(HOST_NAME);
      nativePort = port;
      port.onMessage.addListener((message) => {
        if (!message || typeof message !== "object") return;
        const id = message.id;
        if (id !== undefined && pending.has(id)) {
          const { resolve: ok, reject: bad, timer } = pending.get(id);
          pending.delete(id);
          clearTimeout(timer);
          if (message.ok === false) bad(new Error(translateBridgeError(message.error || "本地桥接程序出错。")));
          else ok(message);
        }
      });
      port.onDisconnect.addListener(async () => {
        const err = translateBridgeError(chrome.runtime.lastError?.message || "Native bridge disconnected");
        nativePort = null;
        for (const [, waiter] of pending) {
          clearTimeout(waiter.timer);
          waiter.reject(new Error(err));
        }
        pending.clear();
        const state = await getStoredState();
        // A Native Messaging disconnect must never leave a localhost PAC behind,
        // regardless of what storage.session currently says.
        await saveState({ enabled: false, resolvedCountry: "", lastError: state.enabled ? err : state.lastError });
        await clearChromeProxy();
        await syncRegionShield({ ...state, enabled: false, resolvedCountry: "" });
        await syncPrivacySettings({ ...state, enabled: false });
        await updateAction(false, state.proxyMode);
      });
      resolve(port);
    } catch (error) {
      nativePort = null;
      reject(error);
    }
  });
}

async function nativeRequest(command, payload = {}, timeoutMs = 120000) {
  const port = await connectNative();
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(translateBridgeError(`Native bridge timeout while running ${command}`)));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    port.postMessage({ id, command, ...payload });
  });
}

async function nativeOneShot(command, payload = {}, timeoutMs = 120000) {
  const message = { id: nextRequestId++, command, ...payload };
  const request = chrome.runtime.sendNativeMessage(HOST_NAME, message).then((response) => {
    if (!response) throw new Error(translateBridgeError("Native bridge returned no response"));
    if (response.ok === false) throw new Error(translateBridgeError(response.error || "本地桥接程序出错。"));
    return response;
  });
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(translateBridgeError(`Native bridge timeout while running ${command}`))), timeoutMs);
  });
  return Promise.race([request, timeout]);
}

async function requestForCurrentState(command, payload = {}, timeoutMs = 120000) {
  const state = await getStoredState();
  return state.enabled ? nativeRequest(command, payload, timeoutMs) : nativeOneShot(command, payload, timeoutMs);
}


function privacyControlBlocked(details) {
  return details?.levelOfControl === "controlled_by_other_extensions" ||
    details?.levelOfControl === "not_controllable";
}

async function setPrivacyChromeSetting(setting, value, label) {
  if (!setting?.get || !setting?.set) {
    throw new Error(`${label}：当前 Chrome 不支持此隐私设置。`);
  }
  const details = await setting.get({});
  if (privacyControlBlocked(details)) {
    throw new Error(`${label}无法修改：该设置正被其他扩展或管理员策略控制。`);
  }
  await setting.set({ value, scope: "regular" });
  return setting.get({});
}

async function clearPrivacyChromeSetting(setting) {
  if (!setting?.get || !setting?.clear) return null;
  const details = await setting.get({});
  if (details?.levelOfControl === "controlled_by_this_extension") {
    await setting.clear({ scope: "regular" });
  }
  return setting.get({});
}

async function applyWebRtcLeakProtection(enabled) {
  const setting = chrome.privacy?.network?.webRTCIPHandlingPolicy;
  if (!setting) return { supported: false, effective: null, levelOfControl: "not_controllable" };
  if (enabled) {
    const details = await setPrivacyChromeSetting(setting, "disable_non_proxied_udp", "WebRTC 防泄漏");
    return { supported: true, effective: details.value, levelOfControl: details.levelOfControl };
  }
  const details = await clearPrivacyChromeSetting(setting);
  return { supported: true, effective: details?.value ?? null, levelOfControl: details?.levelOfControl ?? "controllable_by_this_extension" };
}

async function clearLegacyGlobalDnsPredictionOverride() {
  try { await clearPrivacyChromeSetting(chrome.privacy?.network?.networkPredictionEnabled); } catch (_) {}
}

const DNS_PREFETCH_RULE_ID = 91002;

async function clearDnsPrefetchRule() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [DNS_PREFETCH_RULE_ID] }); } catch (_) {}
}

function routedRequestConditionForState(state, resourceTypes = null) {
  const mode = normalizeProxyMode(state.proxyMode);
  const condition = { regexFilter: "^https?://" };
  if (Array.isArray(resourceTypes) && resourceTypes.length) condition.resourceTypes = resourceTypes;
  if (mode === "allowlist") {
    const requestDomains = expandRouteDomains(state.allowlist);
    if (!requestDomains.length) return null;
    condition.requestDomains = requestDomains;
  } else {
    const excludedRequestDomains = expandRouteDomains(state.bypassSites);
    if (excludedRequestDomains.length) condition.excludedRequestDomains = excludedRequestDomains;
  }
  return condition;
}

async function applyDnsPredictionProtection(enabled, state) {
  // v0.6.x used chrome.privacy.networkPredictionEnabled, which is Chrome-wide.
  // Always release that legacy override. Route-scoped protection now uses the
  // per-document X-DNS-Prefetch-Control response header instead, so DIRECT pages
  // keep Chrome's normal DNS prefetch/preconnect acceleration.
  await clearLegacyGlobalDnsPredictionOverride();
  await clearDnsPrefetchRule();
  const supported = Boolean(chrome.declarativeNetRequest?.updateDynamicRules);
  if (!supported || !enabled || !state?.enabled) {
    return { supported, active: false, effective: null, levelOfControl: supported ? "controlled_by_this_extension" : "not_controllable" };
  }
  const condition = routedRequestConditionForState(state, ["main_frame", "sub_frame"]);
  if (!condition) {
    return { supported: true, active: false, effective: null, levelOfControl: "controlled_by_this_extension" };
  }
  const rule = {
    id: DNS_PREFETCH_RULE_ID,
    priority: 2,
    action: {
      type: "modifyHeaders",
      responseHeaders: [{ header: "x-dns-prefetch-control", operation: "set", value: "off" }]
    },
    condition
  };
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [rule], removeRuleIds: [] });
  return { supported: true, active: true, effective: "route_scoped", levelOfControl: "controlled_by_this_extension" };
}

async function syncPrivacySettings(stateOverride = null) {
  const state = stateOverride || await getStoredState();
  const result = { webRtc: null, dnsPrediction: null, errors: [] };
  try {
    result.webRtc = await applyWebRtcLeakProtection(Boolean(state.webRtcLeakProtection));
  } catch (error) {
    result.errors.push(error.message);
  }
  try {
    result.dnsPrediction = await applyDnsPredictionProtection(Boolean(state.dnsPredictionProtection), state);
  } catch (error) {
    result.errors.push(error.message);
  }
  return result;
}

async function getPrivacyStatus(stateOverride = null) {
  const state = stateOverride || await getStoredState();
  const result = {
    webRtc: { requested: Boolean(state.webRtcLeakProtection), supported: false, effective: null, levelOfControl: "not_controllable" },
    dnsPrediction: { requested: Boolean(state.dnsPredictionProtection), active: false, supported: Boolean(chrome.declarativeNetRequest?.getDynamicRules), effective: null, levelOfControl: chrome.declarativeNetRequest?.getDynamicRules ? "controlled_by_this_extension" : "not_controllable" }
  };
  try {
    const setting = chrome.privacy?.network?.webRTCIPHandlingPolicy;
    if (setting?.get) {
      const details = await setting.get({});
      result.webRtc = { ...result.webRtc, supported: true, effective: details.value, levelOfControl: details.levelOfControl };
    }
  } catch (_) {}
  try {
    if (chrome.declarativeNetRequest?.getDynamicRules) {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      const active = rules.some((rule) => rule.id === DNS_PREFETCH_RULE_ID);
      result.dnsPrediction = { ...result.dnsPrediction, supported: true, active, effective: active ? "route_scoped" : null };
    }
  } catch (_) {}
  return result;
}

async function setPrivacyOption(option, enabled) {
  const state = await getStoredState();
  if (option === "webRtcLeakProtection") {
    await applyWebRtcLeakProtection(Boolean(enabled));
    await saveState({ webRtcLeakProtection: Boolean(enabled) });
    return { ok: true, webRtcLeakProtection: Boolean(enabled), privacy: await getPrivacyStatus({ ...state, webRtcLeakProtection: Boolean(enabled) }) };
  }
  if (option === "dnsPredictionProtection") {
    await saveState({ dnsPredictionProtection: Boolean(enabled) });
    const next = { ...state, dnsPredictionProtection: Boolean(enabled) };
    await applyDnsPredictionProtection(Boolean(enabled), next);
    return { ok: true, dnsPredictionProtection: Boolean(enabled), privacy: await getPrivacyStatus(next) };
  }
  throw new Error("未知的隐私设置。");
}

async function clearAllPrivacyOverrides() {
  try { await clearPrivacyChromeSetting(chrome.privacy?.network?.webRTCIPHandlingPolicy); } catch (_) {}
  await clearLegacyGlobalDnsPredictionOverride();
  await clearDnsPrefetchRule();
}


const REGION_HEADER_RULE_ID = 91001;
const REGION_TZ = {
  AT:"Europe/Vienna", AU:"Australia/Sydney", BE:"Europe/Brussels", BG:"Europe/Sofia",
  CA:"America/Toronto", CH:"Europe/Zurich", CL:"America/Santiago", CO:"America/Bogota",
  DE:"Europe/Berlin", DK:"Europe/Copenhagen", ES:"Europe/Madrid", FI:"Europe/Helsinki",
  FR:"Europe/Paris", GB:"Europe/London", HK:"Asia/Hong_Kong", IE:"Europe/Dublin",
  IT:"Europe/Rome", JP:"Asia/Tokyo", MX:"America/Mexico_City", MY:"Asia/Kuala_Lumpur",
  NL:"Europe/Amsterdam", NO:"Europe/Oslo", NZ:"Pacific/Auckland", PL:"Europe/Warsaw",
  PT:"Europe/Lisbon", SE:"Europe/Stockholm", SG:"Asia/Singapore", TH:"Asia/Bangkok",
  TW:"Asia/Taipei", US:"America/New_York", ZA:"Africa/Johannesburg"
};
function regionProfileForState(state) {
  const raw = String(state.resolvedCountry || (state.country !== "REC" ? state.country : "US") || "US").toUpperCase();
  const country = /^[A-Z]{2}$/.test(raw) ? raw : "US";
  const locale = `en-${country}`;
  return { country, locale, languages:[locale, "en"], timeZone: REGION_TZ[country] || "America/New_York" };
}
function regionShieldIsActive(state) { return Boolean(state.regionShieldEnabled && state.enabled); }

function regionContentConfigForState(state, host = "") {
  const routedThroughVpn = host ? routeUsesVpnForState(state, host) : true;
  return { active: Boolean(regionShieldIsActive(state) && routedThroughVpn), profile: regionProfileForState(state) };
}

async function broadcastRegionContentConfig(state) {
  const fallback = regionContentConfigForState(state);
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => {
        const host = hostnameFromUrl(tab.url);
        const config = regionContentConfigForState(state, host);
        return chrome.tabs.sendMessage(tab.id, { type: "regionConfigPush", config }).catch(() => null);
      }));
  } catch (_) {}
  return fallback;
}
async function clearRegionHeaderRule() {
  if (!chrome.declarativeNetRequest?.updateDynamicRules) return;
  try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds:[REGION_HEADER_RULE_ID] }); } catch (_) {}
}
async function syncRegionHeaderRule(state) {
  await clearRegionHeaderRule();
  if (!regionShieldIsActive(state)) return;
  const profile = regionProfileForState(state);
  const condition = routedRequestConditionForState(state);
  if (!condition) return;
  const rule = {
    id: REGION_HEADER_RULE_ID,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header:"accept-language", operation:"set", value:`${profile.locale},en;q=0.9` }]
    },
    condition
  };
  await chrome.declarativeNetRequest.updateDynamicRules({ addRules:[rule], removeRuleIds:[] });
}
async function syncRegionGeolocation(state) {
  if (!chrome.contentSettings?.location) return;
  await chrome.contentSettings.location.clear({ scope:"regular" });
  if (!regionShieldIsActive(state)) return;
  await chrome.contentSettings.location.set({ primaryPattern:"<all_urls>", setting:"block", scope:"regular" });
}
async function syncRegionShield(stateOverride=null) {
  const state = stateOverride || await getStoredState();
  const errors = [];
  try { await syncRegionHeaderRule(state); } catch (e) { errors.push(`语言请求头：${e.message}`); }
  try { await syncRegionGeolocation(state); } catch (e) { errors.push(`地理定位：${e.message}`); }
  // Push the session-dependent state to already-open pages immediately.
  // `enabled` and `resolvedCountry` live in storage.session, which content
  // scripts cannot reliably observe directly. Without this push, a tab that
  // was opened before VPN activation would remain in active=false forever.
  await broadcastRegionContentConfig(state);
  return { active:regionShieldIsActive(state), profile:regionProfileForState(state), errors };
}
async function setRegionShieldOption(option, value) {
  if (option !== "enabled") throw new Error("未知的区域隐私保护设置。");
  const state = await getStoredState();
  const regionShieldEnabled = Boolean(value);
  await saveState({ regionShieldEnabled });
  const next = { ...state, regionShieldEnabled };
  return { ok:true, regionShieldEnabled, region:await syncRegionShield(next) };
}
async function regionContentConfig(host = "") {
  const state = await getStoredState();
  return regionContentConfigForState(state, host);
}
async function clearAllRegionShieldOverrides() {
  await clearRegionHeaderRule();
  try { await chrome.contentSettings?.location?.clear({ scope:"regular" }); } catch (_) {}
}

async function proxyControlInfo() {
  return chrome.proxy.settings.get({ incognito: false });
}

function pacForState(state) {
  const mode = normalizeProxyMode(state.proxyMode);
  const domains = mode === "allowlist" ? state.allowlist : state.bypassSites;
  const encoded = JSON.stringify(expandRouteDomains(domains));
  const proxy = `SOCKS5 ${PROXY_HOST}:${PROXY_PORT}`;
  return `
function FindProxyForURL(url, host) {
  host = (host || "").toLowerCase();
  if (!host || isPlainHostName(host) || host === "localhost" || host === "127.0.0.1" || host === "::1") return "DIRECT";
  var domains = ${encoded};
  var matched = false;
  for (var i = 0; i < domains.length; i++) {
    var d = domains[i];
    if (host === d || dnsDomainIs(host, "." + d)) { matched = true; break; }
  }
  if (${JSON.stringify(mode)} === "allowlist") return matched ? ${JSON.stringify(proxy)} : "DIRECT";
  return matched ? "DIRECT" : ${JSON.stringify(proxy)};
}`.trim();
}

async function applyChromeProxy(stateOverride = null) {
  const current = await proxyControlInfo();
  if (current.levelOfControl === "controlled_by_other_extensions" || current.levelOfControl === "not_controllable") {
    throw new Error("Chrome 代理正被另一个扩展或管理员策略控制。");
  }
  const state = stateOverride || await getStoredState();
  const config = {
    mode: "pac_script",
    pacScript: {
      mandatory: true,
      data: pacForState(state)
    }
  };
  await chrome.proxy.settings.set({ value: config, scope: "regular" });
}

function sleepMs(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function clearChromeProxy() {
  // Fail-open must win over everything else. Chrome may keep a PAC script in its
  // network service for a short time after clear(). Force a DIRECT config first
  // so an already-stopped localhost SOCKS listener can never black-hole traffic,
  // then release our proxy control back to Chrome/system settings.
  try {
    const current = await proxyControlInfo();
    if (current?.levelOfControl === "controlled_by_this_extension") {
      try {
        await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" });
        await sleepMs(80);
      } catch (_) {}
    }
    try { await chrome.proxy.settings.clear({ scope: "regular" }); } catch (_) {}
    await sleepMs(40);
    const after = await proxyControlInfo().catch(() => null);
    // Last-resort safety net: if Chrome still reports our stale PAC as active,
    // leave an explicit DIRECT config rather than a dead localhost proxy.
    if (after?.levelOfControl === "controlled_by_this_extension" && after?.value?.mode === "pac_script") {
      try { await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" }); } catch (_) {}
    }
  } catch (_) {
    // If status inspection itself failed, still attempt both operations.
    try { await chrome.proxy.settings.set({ value: { mode: "direct" }, scope: "regular" }); } catch (_) {}
    try { await chrome.proxy.settings.clear({ scope: "regular" }); } catch (_) {}
  }
}

async function updateAction(enabled, proxyMode = "allowlist") {
  try {
    await chrome.action.setBadgeText({ text: enabled ? "VPN" : "" });
    await chrome.action.setBadgeBackgroundColor({ color: enabled ? "#00a400" : "#737373" });
    await chrome.action.setTitle({ title: enabled ? `VPN 已开启 · ${normalizeProxyMode(proxyMode) === "allowlist" ? "白名单" : "黑名单"}` : "VPN 已关闭" });
  } catch (_) {}
}

async function startVpn(country) {
  const selected = country || "REC";
  await saveState({ country: selected, lastError: "" });
  try {
    // Always bootstrap the localhost helper while Chrome is direct. Only install the
    // PAC script after the SOCKS listener has reported ready. This prevents a stale
    // localhost proxy from black-holing startup traffic.
    await clearChromeProxy();
    const response = await nativeRequest("start", { country: selected }, 150000);
    const state = await getStoredState();
    const nextState = { ...state, enabled: true, country: selected, lastError: "" };
    // SOCKS5 is ready. Install route-scoped DNS prefetch protection (when requested)
    // before installing the PAC proxy, then switch browser traffic to the tunnel.
    await syncPrivacySettings(nextState);
    await applyChromeProxy(nextState);
    const resolvedCountry = String(response?.resolvedCountry || (selected !== "REC" ? selected : ""));
    await saveState({ enabled: true, resolvedCountry, country: selected, lastError: "" });
    await syncRegionShield({ ...nextState, resolvedCountry });
    await updateAction(true, nextState.proxyMode);
    return response;
  } catch (error) {
    // Failure during startup must become DIRECT immediately; do not wait for the
    // helper to acknowledge a stop before restoring browser connectivity.
    await saveState({ enabled: false, resolvedCountry: "", lastError: error.message });
    await clearChromeProxy();
    const offState = { ...(await getStoredState()), enabled: false, resolvedCountry: "" };
    await syncRegionShield(offState);
    await syncPrivacySettings(offState);
    await updateAction(false, offState.proxyMode);
    try { if (nativePort) await nativeRequest("stop", {}, 6000); } catch (_) {}
    if (nativePort) { try { nativePort.disconnect(); } catch (_) {} nativePort = null; }
    await clearChromeProxy();
    throw error;
  }
}

async function stopVpn() {
  // Mark the session off first, then make Chrome DIRECT before touching the helper.
  // Even if the Native Messaging stop request hangs/crashes, browser traffic is
  // already fail-open and the region/DNS overrides are being removed.
  await saveState({ enabled: false, resolvedCountry: "", lastError: "" });
  await clearChromeProxy();
  const offState = { ...(await getStoredState()), enabled: false, resolvedCountry: "" };
  await syncRegionShield(offState);
  await syncPrivacySettings(offState);
  await updateAction(false, offState.proxyMode);
  try {
    if (nativePort) await nativeRequest("stop", {}, 6000);
  } catch (_) {
    // The helper may close the native pipe as part of a normal stop. Browser is
    // already DIRECT, so a stop acknowledgement is not required for safety.
  } finally {
    if (nativePort) { try { nativePort.disconnect(); } catch (_) {} nativePort = null; }
    await clearChromeProxy();
  }
  return { ok: true };
}

async function changeCountry(country) {
  const state = await getStoredState();
  await saveState({ country });
  if (!state.enabled) return { ok: true, restarted: false };
  await saveState({ enabled: false, resolvedCountry: "" });
  await clearChromeProxy();
  await syncRegionShield({ ...state, enabled: false, resolvedCountry: "", country });
  await syncPrivacySettings({ ...state, enabled: false, country });
  try {
    const response = await nativeRequest("start", { country }, 150000);
    const nextState = { ...state, country, enabled: true };
    await syncPrivacySettings(nextState);
    await applyChromeProxy(nextState);
    const resolvedCountry = String(response?.resolvedCountry || (country !== "REC" ? country : ""));
    await saveState({ enabled: true, resolvedCountry, country, lastError: "" });
    await syncRegionShield({ ...nextState, resolvedCountry });
    return { ...response, restarted: true };
  } catch (error) {
    await saveState({ enabled: false, resolvedCountry: "", country, lastError: error.message });
    await clearChromeProxy();
    const offState = { ...(await getStoredState()), enabled: false, resolvedCountry: "" };
    await syncRegionShield(offState);
    await syncPrivacySettings(offState);
    await updateAction(false, offState.proxyMode);
    try { if (nativePort) await nativeRequest("stop", {}, 6000); } catch (_) {}
    if (nativePort) { try { nativePort.disconnect(); } catch (_) {} nativePort = null; }
    await clearChromeProxy();
    throw error;
  }
}

async function setAutoConnect(enabled) {
  const autoConnect = Boolean(enabled);
  await saveState({ autoConnect });
  return { ok: true, autoConnect };
}

async function syncRouteDependentProtections(state) {
  await syncPrivacySettings(state);
  await syncRegionShield(state);
}

async function setProxyMode(mode) {
  const proxyMode = normalizeProxyMode(mode);
  const state = await getStoredState();
  const next = { ...state, proxyMode };
  await saveState({ proxyMode });
  if (state.enabled) await applyChromeProxy(next);
  await syncRouteDependentProtections(next);
  await updateAction(state.enabled, proxyMode);
  return { ok: true, proxyMode };
}

async function setSiteRule(domainInput, useVpn) {
  const domain = canonicalManagedDomain(domainInput);
  const state = await getStoredState();
  let allowlist = [...state.allowlist];
  let bypassSites = [...state.bypassSites];
  if (normalizeProxyMode(state.proxyMode) === "allowlist") {
    if (useVpn) {
      if (!listCoversHost(allowlist, domain)) allowlist = [...allowlist, domain];
    } else {
      allowlist = allowlist.filter((rule) => !ruleCoversHost(rule, domain));
    }
  } else {
    if (useVpn) {
      bypassSites = bypassSites.filter((rule) => !ruleCoversHost(rule, domain));
    } else if (!listCoversHost(bypassSites, domain)) {
      bypassSites = [...bypassSites, domain];
    }
  }
  allowlist = normalizeManagedDomainArray(allowlist);
  bypassSites = normalizeManagedDomainArray(bypassSites);
  const next = { ...state, allowlist, bypassSites };
  await saveState({ allowlist, bypassSites });
  if (state.enabled) await applyChromeProxy(next);
  await syncRouteDependentProtections(next);
  return { ok: true, domain, useVpn: Boolean(useVpn), allowlist, bypassSites };
}

async function addManagedDomain(domainInput) {
  const domain = canonicalManagedDomain(domainInput);
  const state = await getStoredState();
  let allowlist = [...state.allowlist];
  let bypassSites = [...state.bypassSites];
  if (normalizeProxyMode(state.proxyMode) === "allowlist") {
    allowlist = normalizeManagedDomainArray([...allowlist, domain]);
  } else {
    bypassSites = normalizeManagedDomainArray([...bypassSites, domain]);
  }
  const next = { ...state, allowlist, bypassSites };
  await saveState({ allowlist, bypassSites });
  if (state.enabled) await applyChromeProxy(next);
  await syncRouteDependentProtections(next);
  return { ok: true, allowlist, bypassSites };
}

async function removeManagedDomain(domainInput) {
  const domain = canonicalManagedDomain(domainInput);
  const state = await getStoredState();
  const allowlist = state.allowlist.filter((x) => x !== domain);
  const bypassSites = state.bypassSites.filter((x) => x !== domain);
  const next = { ...state, allowlist, bypassSites };
  await saveState({ allowlist, bypassSites });
  if (state.enabled) await applyChromeProxy(next);
  await syncRouteDependentProtections(next);
  return { ok: true, allowlist, bypassSites };
}


async function prepareCleanup(mode) {
  await clearChromeProxy();
  try { if (nativePort) await nativeRequest("stop", {}, 15000); }
  finally {
    await saveState({ enabled: false, resolvedCountry: "", lastError: "" });
    if (mode === "full") { await clearAllPrivacyOverrides(); await clearAllRegionShieldOverrides(); }
    else {
      await syncRegionShield({ ...(await getStoredState()), enabled: false, resolvedCountry: "" });
      await syncPrivacySettings({ ...(await getStoredState()), enabled: false });
    }
    await updateAction(false);
  }
  const result = await nativeRequest("prepare_cleanup", { mode }, 15000);
  if (nativePort) { try { nativePort.disconnect(); } catch (_) {} nativePort = null; }
  return result;
}

async function fullStatus() {
  const state = await getStoredState();
  // Opening the popup is also a self-heal point for any PAC that survived an
  // unclean browser/helper shutdown while the logical VPN state is off.
  if (!state.enabled) await clearChromeProxy();
  let helper = { available: false, running: false, credentials: false };
  let helperError = "";
  try {
    const response = state.enabled ? await nativeRequest("status", {}, 15000) : await nativeOneShot("status", {}, 15000);
    helper = response.status || helper;
  } catch (error) { helperError = error.message; }
  const [proxy, privacy, region] = await Promise.all([proxyControlInfo(), getPrivacyStatus(state), syncRegionShield(state)]);
  return { ok: true, state, helper, helperError, proxyLevel: proxy.levelOfControl, privacy, region };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "status": return fullStatus();
      case "toggle": return message.enabled ? startVpn(message.country) : stopVpn();
      case "country": return changeCountry(message.country);
      case "autoConnect": return setAutoConnect(Boolean(message.enabled));
      case "privacyOption": return setPrivacyOption(message.option, Boolean(message.enabled));
      case "privacyStatus": return { ok: true, privacy: await getPrivacyStatus() };
      case "regionShield": return setRegionShieldOption(message.option, message.value);
      case "regionStatus": { const state = await getStoredState(); return { ok:true, region:await syncRegionShield(state) }; }
      case "regionContentConfig": return { ok:true, config:await regionContentConfig(message.host || "") };
      case "proxyMode": return setProxyMode(message.mode);
      case "setSiteRule": return setSiteRule(message.domain, Boolean(message.useVpn));
      case "addManagedDomain": return addManagedDomain(message.domain);
      case "removeManagedDomain": return removeManagedDomain(message.domain);
      case "importFirefox": return requestForCurrentState("import_firefox", {}, 150000);
      case "usage": return requestForCurrentState("usage", {}, 90000);
      case "locations": return requestForCurrentState("locations", {}, 45000);
      case "sync": return requestForCurrentState("sync", {}, 90000);
      case "openInstallFolder": return requestForCurrentState("open_folder", {}, 10000);
      case "prepareRemoveLocal": return prepareCleanup("local");
      case "prepareFullUninstall": return prepareCleanup("full");
      case "cancelCleanup": return nativeOneShot("cancel_cleanup", { token: message.token }, 10000);
      default: throw new Error("未知的扩展命令。");
    }
  })().then(sendResponse).catch((error) => {
    saveState({ lastError: error.message }).finally(() => sendResponse({ ok: false, error: error.message }));
  });
  return true;
});


async function stopVpnWhenLastWindowCloses() {
  try {
    const windows = await chrome.windows.getAll({ windowTypes: ["normal"] });
    if (windows.length !== 0) return;
    const state = await getStoredState();
    if (state.enabled) await stopVpn();
  } catch (_) {
    // The Native Messaging pipe + Windows Job Object are still the final safety net.
  }
}

chrome.windows.onRemoved.addListener(() => {
  // Let Chrome finish removing the window before counting remaining windows.
  setTimeout(stopVpnWhenLastWindowCloses, 200);
});

async function resetVpnForFreshBrowserSession(reason = "") {
  // Chrome can persist extension-owned proxy settings across an unclean browser/OS shutdown.
  // Never point a fresh Chrome session at a localhost SOCKS port before the helper is ready.
  await clearChromeProxy();
  if (nativePort) {
    try { nativePort.disconnect(); } catch (_) {}
    nativePort = null;
  }
  const state = await getStoredState();
  await saveState({ enabled: false, resolvedCountry: "", lastError: reason || "" });
  await syncRegionShield({ ...state, enabled: false, resolvedCountry: "" });
  await syncPrivacySettings({ ...state, enabled: false });
  await updateAction(false, state.proxyMode);
}

async function migrateRoutingModeAndDnsScopeOnce() {
  const raw = await chrome.storage.local.get(["proxyMode", "routingModeSchema"]);
  if (Number(raw.routingModeSchema || 0) >= 2) {
    // Even after migration, release any stale v0.6.x global DNS predictor override.
    await clearLegacyGlobalDnsPredictionOverride();
    return;
  }
  // Fresh installs start in allowlist mode. Existing legacy "all" mode maps to
  // blacklist so an update never silently reroutes every site in the opposite way.
  const proxyMode = raw.proxyMode === undefined ? "allowlist" : normalizeProxyMode(raw.proxyMode);
  await chrome.storage.local.set({ proxyMode, routingModeSchema: 2 });
  await clearLegacyGlobalDnsPredictionOverride();
  const state = await getStoredState();
  await syncPrivacySettings(state);
  await syncRegionShield(state);
}

async function migrateRuntimeStateOnce() {
  // v0.5.6 and earlier stored `enabled` persistently. If Windows killed Chrome while
  // VPN was on, both enabled=true and the PAC proxy could survive into the next launch.
  const old = await chrome.storage.local.get({ runtimeStateSchema: 0, enabled: false });
  if (Number(old.runtimeStateSchema || 0) >= 1) return;
  await clearChromeProxy();
  await chrome.storage.local.remove("enabled");
  await chrome.storage.local.set({ runtimeStateSchema: 1 });
  await chrome.storage.session.set({ enabled: false, resolvedCountry: "" });
  const state = await getStoredState();
  await syncPrivacySettings({ ...state, enabled: false });
  await updateAction(false, state.proxyMode);
}

async function handleBrowserStartup() {
  // Always begin fail-open: remove any stale PAC/SOCKS state before doing network work.
  await resetVpnForFreshBrowserSession();
  const state = await getStoredState();
  if (!state.autoConnect) return;
  try {
    // startVpn() launches the Native Messaging helper first, waits for SOCKS5 readiness,
    // and only then installs Chrome's PAC script. A failure therefore leaves Chrome direct.
    await startVpn(state.country);
  } catch (error) {
    await clearChromeProxy();
    await saveState({ enabled: false, resolvedCountry: "", lastError: `启动时自动连接失败：${error.message}` });
    await syncRegionShield({ ...state, enabled: false, resolvedCountry: "" });
    await syncPrivacySettings({ ...state, enabled: false });
    await updateAction(false, state.proxyMode);
  }
}

chrome.runtime.onStartup.addListener(() => {
  handleBrowserStartup().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  // Reload/update must also fail open: a Native Messaging host may have been killed
  // while Chrome still remembers the old PAC script.
  resetVpnForFreshBrowserSession().catch(() => {});
});

// One-time migration executes immediately after upgrading/reloading from <= 0.5.6,
// so a stale PAC setting is cleared without waiting for the next browser restart.
(async () => {
  await migrateRuntimeStateOnce();
  await migrateRoutingModeAndDnsScopeOnce();
})().catch(() => {});

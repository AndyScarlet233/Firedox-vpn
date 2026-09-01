$ErrorActionPreference = 'Stop'

$HostName = 'org.firefox_ip_protection.chrome_bridge'
$ExtensionId = 'dlogjlmofifonkgbcnjalehpmkdmegnd'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

function Write-Step([string]$Message) {
    Write-Host "[Firedox] $Message"
}

function Get-RegisteredManifestPaths {
    $keys = @(
        "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
        "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
        "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName"
    )
    $paths = New-Object System.Collections.Generic.List[string]
    foreach ($key in $keys) {
        if (Test-Path $key) {
            try {
                $value = (Get-Item $key).GetValue('')
                if ($value) { [void]$paths.Add([string]$value) }
            } catch {}
        }
    }
    return $paths | Select-Object -Unique
}

function Stop-RegisteredBridgeProcesses([string[]]$ManifestPaths) {
    $exePaths = New-Object System.Collections.Generic.List[string]
    foreach ($manifestPath in $ManifestPaths) {
        if (-not (Test-Path $manifestPath)) { continue }
        try {
            $json = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($json.path) {
                $candidate = [Environment]::ExpandEnvironmentVariables([string]$json.path)
                if (-not [IO.Path]::IsPathRooted($candidate)) {
                    $candidate = Join-Path (Split-Path -Parent $manifestPath) $candidate
                }
                try { $candidate = (Resolve-Path -LiteralPath $candidate).Path } catch {}
                [void]$exePaths.Add($candidate)
            }
        } catch {}
    }

    if (-not $exePaths.Count) { return }
    $targets = $exePaths | Select-Object -Unique
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
        $procPath = $_.ExecutablePath
        if (-not $procPath) { return }
        foreach ($target in $targets) {
            if ([string]::Equals($procPath, $target, [StringComparison]::OrdinalIgnoreCase)) {
                Write-Step "Stopping stale native host PID $($_.ProcessId): $procPath"
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                break
            }
        }
    }
}

function Find-BridgeExecutable {
    $preferred = @(
        (Join-Path $Root 'runtime\vpn_bridge_host.exe'),
        (Join-Path $Root 'vpn_bridge_host.exe'),
        (Join-Path $Root 'host\vpn_bridge_host.exe')
    )
    foreach ($candidate in $preferred) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $found = Get-ChildItem -LiteralPath $Root -Filter 'vpn_bridge_host.exe' -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    return $null
}

try {
    Write-Step 'Repairing Native Messaging registration...'

    $oldManifests = @(Get-RegisteredManifestPaths)
    Stop-RegisteredBridgeProcesses $oldManifests

    $bridgeExe = Find-BridgeExecutable
    if (-not $bridgeExe) {
        throw "vpn_bridge_host.exe was not found under '$Root'. This public source tree does not ship the private/prebuilt runtime; run this repair script from the complete working package."
    }

    $runtimeDir = Split-Path -Parent $bridgeExe
    $manifestPath = Join-Path $runtimeDir 'org.firefox_ip_protection.chrome_bridge.json'

    $manifest = [ordered]@{
        name = $HostName
        description = 'Firefox IP Protection Native Messaging bridge'
        path = $bridgeExe
        type = 'stdio'
        allowed_origins = @("chrome-extension://$ExtensionId/")
    }
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    $registryKeys = @(
        "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
        "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
        "HKCU:\Software\Chromium\NativeMessagingHosts\$HostName"
    )
    foreach ($key in $registryKeys) {
        New-Item -Path $key -Force | Out-Null
        Set-Item -Path $key -Value $manifestPath
        Write-Step "Registered: $key"
    }

    Write-Step "Bridge executable: $bridgeExe"
    Write-Step "Manifest: $manifestPath"
    Write-Step 'Repair complete. Fully close Chrome/Edge/Chromium, reopen it, then reload the extension.'
    exit 0
} catch {
    Write-Host "[Firedox][ERROR] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

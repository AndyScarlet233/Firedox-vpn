$ErrorActionPreference = 'Stop'
$HostName = 'org.firefox_ip_protection.chrome_bridge'
$ExtensionId = 'dlogjlmofifonkgbcnjalehpmkdmegnd'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
function Write-Step([string]$Message) { Write-Host "[Firedox] $Message" }

function Get-RegisteredManifestPaths {
    $keys=@("HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName","HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName","HKCU:\Software\Chromium\NativeMessagingHosts\$HostName")
    $out=@()
    foreach($k in $keys){ if(Test-Path $k){ try{$v=(Get-Item $k).GetValue(''); if($v){$out+=[string]$v}}catch{}} }
    return $out | Select-Object -Unique
}

function Stop-OldHosts([string[]]$paths){
    foreach($p in $paths){
        try{
            if(Test-Path $p){$j=Get-Content $p -Raw | ConvertFrom-Json; $exe=[Environment]::ExpandEnvironmentVariables([string]$j.path)}
            if($exe){Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe} | ForEach-Object {Write-Step "Stopping stale native host PID $($_.Id): $exe"; Stop-Process $_.Id -Force}}
        }catch{}
    }
}

try{
 Write-Step 'Repairing Native Messaging registration...'
 Stop-OldHosts @(Get-RegisteredManifestPaths)

 $hostPath=Join-Path $Root 'host\native_host.py'
 $runtimeExe=Join-Path $Root 'runtime\vpn_bridge_host.exe'
 if(Test-Path $runtimeExe){
   $manifestPath=Join-Path (Split-Path $runtimeExe) 'org.firefox_ip_protection.chrome_bridge.json'
   $manifest=[ordered]@{name=$HostName;description='Firefox IP Protection Native Messaging bridge';path=$runtimeExe;type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")}
 } elseif(Test-Path $hostPath){
   $python=(Get-Command python -ErrorAction SilentlyContinue).Source
   if(-not $python){throw 'Python was not found. Install Python or use the complete runtime package.'}
   $manifestPath=Join-Path $Root 'org.firefox_ip_protection.chrome_bridge.json'
   $manifest=[ordered]@{name=$HostName;description='Firefox IP Protection Native Messaging bridge';path=$python;args=@($hostPath);type='stdio';allowed_origins=@("chrome-extension://$ExtensionId/")}
   Write-Step 'Using source Python Native Host.'
 } else { throw 'native_host.py was not found.' }

 $manifest|ConvertTo-Json -Depth 5|Set-Content $manifestPath -Encoding UTF8
 foreach($key in @("HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName","HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName","HKCU:\Software\Chromium\NativeMessagingHosts\$HostName")){New-Item $key -Force|Out-Null;Set-Item $key $manifestPath;Write-Step "Registered: $key"}
 Write-Step "Manifest: $manifestPath"
 Write-Step 'Repair complete. Restart browser and reload extension.'
 exit 0
}catch{Write-Host "[Firedox][ERROR] $($_.Exception.Message)" -ForegroundColor Red;exit 1}

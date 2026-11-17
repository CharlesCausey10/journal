param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
$Destination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force $Destination | Out-Null
$details = [ordered]@{
    capturedAt=[DateTime]::UtcNow.ToString('o')
    os=[Environment]::OSVersion.VersionString
    interactive=[Environment]::UserInteractive
    sessionId=(Get-Process -Id $PID).SessionId
    elevated=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
try {
    $details.processes = @(Get-CimInstance Win32_Process |
        Where-Object { $_.Name -in @('journal.exe','msedgewebview2.exe') } |
        Select-Object ProcessId,ParentProcessId,SessionId,Name,ExecutablePath,CommandLine)
    $details.windows = @(Get-Process -Name journal,msedgewebview2 -ErrorAction SilentlyContinue |
        Select-Object Id,Responding,MainWindowTitle,MainWindowHandle,SessionId)
} catch { $details.processError=$_.Exception.Message }
try {
    $details.webviewVersions = @(Get-ChildItem -Path @(
        "${env:ProgramFiles(x86)}/Microsoft/EdgeWebView/Application/*/msedgewebview2.exe",
        "$env:ProgramFiles/Microsoft/EdgeWebView/Application/*/msedgewebview2.exe"
    ) -ErrorAction SilentlyContinue | ForEach-Object {
        @{path=$_.FullName;version=$_.VersionInfo.FileVersion}
    })
    $details.policies = @(
        'HKLM:/SOFTWARE/Policies/Microsoft/Edge',
        'HKCU:/SOFTWARE/Policies/Microsoft/Edge',
        'HKLM:/SOFTWARE/Policies/Microsoft/Edge/WebView2',
        'HKCU:/SOFTWARE/Policies/Microsoft/Edge/WebView2'
    ) | ForEach-Object {
        if (Test-Path -LiteralPath $_) {
            $policy=Get-ItemProperty -LiteralPath $_
            @{path=$_;DeveloperToolsAvailability=$policy.DeveloperToolsAvailability;RemoteDebuggingAllowed=$policy.RemoteDebuggingAllowed;BrowserExecutableFolder=$policy.BrowserExecutableFolder}
        }
    }
} catch { $details.runtimeError=$_.Exception.Message }
# Capture only the hosted CI desktop, never the user's screen on a local run.
if ($env:GITHUB_ACTIONS -eq 'true') {
    try {
        Add-Type -AssemblyName System.Windows.Forms,System.Drawing
        $bounds=[Windows.Forms.SystemInformation]::VirtualScreen
        $bitmap=[Drawing.Bitmap]::new($bounds.Width,$bounds.Height)
        $graphics=[Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.CopyFromScreen($bounds.Location,[Drawing.Point]::Empty,$bounds.Size)
            $bitmap.Save((Join-Path $Destination 'desktop.png'),[Drawing.Imaging.ImageFormat]::Png)
        } finally { $graphics.Dispose();$bitmap.Dispose() }
    } catch { $details.screenshotError=$_.Exception.Message }
}
$details | ConvertTo-Json -Depth 7 | Set-Content (Join-Path $Destination 'environment.json')

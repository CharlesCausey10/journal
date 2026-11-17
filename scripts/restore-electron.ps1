[CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')]
param(
    [string]$JournalExecutable = (Join-Path $PSScriptRoot 'Journal.exe'),
    [string]$SourceDatabase = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'com.charlescausey.journal/journal.sqlite'),
    [string]$ElectronDataDirectory = (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'journal')
)
$ErrorActionPreference = 'Stop'
if (Get-Process -Name journal -ErrorAction SilentlyContinue) {
    throw 'Close both versions of Journal before restoring.'
}
$JournalExecutable = (Resolve-Path -LiteralPath $JournalExecutable).Path
$SourceDatabase = (Resolve-Path -LiteralPath $SourceDatabase).Path
$ElectronDataDirectory = [IO.Path]::GetFullPath($ElectronDataDirectory)
if (!(Test-Path -LiteralPath $ElectronDataDirectory -PathType Container)) {
    throw 'The previous Electron data folder was not found. Install and open Journal 1.1.3 first, then close it.'
}
if (!$PSCmdlet.ShouldProcess($ElectronDataDirectory, 'Replace the Electron journal with your latest Tauri writing and save a recovery copy')) {
    return
}
$id = [Guid]::NewGuid().ToString()
$archive = Join-Path $ElectronDataDirectory "backups/recovery/tauri-return-$id"
New-Item -ItemType Directory -Path $archive -Force | Out-Null
$staged = Join-Path $archive 'after.sqlite'
$arguments = @('--export-electron', ('"' + $SourceDatabase + '"'), ('"' + $staged + '"'))
$export = Start-Process -FilePath $JournalExecutable -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if ($export.ExitCode -ne 0 -or !(Test-Path -LiteralPath $staged)) {
    throw 'Journal could not create a verified Electron-compatible export. The existing Electron journal is still in place.'
}
# A durable pending manifest makes Electron offer recovery after an interruption.
$manifestFolder = Join-Path $ElectronDataDirectory "backups/migrations/tauri-return-$id"
New-Item -ItemType Directory -Path $manifestFolder -Force | Out-Null
$manifestPath = Join-Path $manifestFolder 'manifest.json'
$manifest = @{
    id=$id; createdAt=[DateTime]::UtcNow.ToString('o'); appVersion='1.2.0-beta.1';
    fromSchema=4; toSchema=3; status='pending'; beforeVerified=$false;
    afterVerified=$true; recoveryFolder=$archive
}
function Write-Manifest {
    $temporary = Join-Path $manifestFolder 'manifest.tmp'
    [IO.File]::WriteAllText($temporary, ($manifest | ConvertTo-Json))
    $stream = [IO.File]::Open($temporary, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite)
    try { $stream.Flush($true) } finally { $stream.Dispose() }
    if (Test-Path -LiteralPath $manifestPath) {
        [IO.File]::Replace($temporary, $manifestPath, $null)
    } else {
        [IO.File]::Move($temporary, $manifestPath)
    }
}
Write-Manifest
$moved = [Collections.Generic.List[string]]::new()
$installed = $false
try {
    $ready = Join-Path $archive 'ready.sqlite'
    Copy-Item -LiteralPath $staged -Destination $ready
    foreach ($name in @('journal.sqlite', 'journal.sqlite-wal', 'journal.sqlite-shm', 'journal.sqlite-journal')) {
        $original = [IO.Path]::GetFullPath((Join-Path $ElectronDataDirectory $name))
        $saved = [IO.Path]::GetFullPath((Join-Path $archive $name))
        if (!$original.StartsWith($ElectronDataDirectory + [IO.Path]::DirectorySeparatorChar) -or !$saved.StartsWith($archive + [IO.Path]::DirectorySeparatorChar)) {
            throw 'Invalid recovery path'
        }
        if (Test-Path -LiteralPath $original) {
            Move-Item -LiteralPath $original -Destination $saved
            $moved.Add($name)
        }
    }
    Move-Item -LiteralPath $ready -Destination (Join-Path $ElectronDataDirectory 'journal.sqlite')
    $installed = $true
    $manifest.status = 'superseded'
    Write-Manifest
} catch {
    # Restore the displaced files on an ordinary filesystem failure.
    if ($installed) {
        Remove-Item -LiteralPath (Join-Path $ElectronDataDirectory 'journal.sqlite')
    }
    foreach ($name in $moved) {
        Move-Item -LiteralPath (Join-Path $archive $name) -Destination (Join-Path $ElectronDataDirectory $name)
    }
    $manifest.status = 'superseded'
    Write-Manifest
    throw
}
Write-Output "Your latest journal is ready in Electron 1.1.3. Recovery copy saved in $archive"

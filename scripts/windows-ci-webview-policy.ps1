param(
    [Parameter(Mandatory=$true)][string]$StateFile,
    [switch]$Restore
)
$ErrorActionPreference='Stop'
# Hosted runners launch elevated. WebView2 150+ ignores environment overrides
# in this context, but honors its documented app-scoped machine policy.
# https://github.com/MicrosoftEdge/WebView2Feedback/issues/5645
if ($env:GITHUB_ACTIONS -ne 'true') {
    throw 'This helper is restricted to disposable GitHub Actions runners.'
}
$policy='HKLM:/SOFTWARE/Policies/Microsoft/Edge/WebView2/AdditionalBrowserArguments'
$application='journal.exe'
if ($Restore) {
    $previous=Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
    if ($previous.existed) {
        New-ItemProperty -Path $policy -Name $application -Value $previous.value -PropertyType String -Force | Out-Null
    } else {
        Remove-ItemProperty -Path $policy -Name $application -ErrorAction SilentlyContinue
    }
    return
}
$BrowserArguments = $env:JOURNAL_CI_WEBVIEW_ARGUMENTS
if ([string]::IsNullOrWhiteSpace($BrowserArguments)) { throw 'Browser arguments are required.' }
$previous=$null
if (Test-Path -LiteralPath $policy) {
    $previous=(Get-ItemProperty -LiteralPath $policy).PSObject.Properties[$application]
}
@{existed=($null -ne $previous);value=if($previous){$previous.Value}else{$null}} |
    ConvertTo-Json | Set-Content -LiteralPath $StateFile
New-Item -Path $policy -Force | Out-Null
New-ItemProperty -Path $policy -Name $application -Value $BrowserArguments -PropertyType String -Force | Out-Null
Write-Output 'Configured app-scoped WebView2 debugging for the CI test.'

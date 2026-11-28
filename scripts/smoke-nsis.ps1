param(
    [Parameter(Mandatory)][string]$Installers,
    [Parameter(Mandatory)][string]$PreviousTag,
    [Parameter(Mandatory)][string]$ReleaseTag,
    [switch]$RequireSignature
)
$ErrorActionPreference = 'Stop'
if (!$IsWindows -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This test installs and uninstalls Lumberjack. Use a disposable GitHub-hosted Windows runner.'
}

$installDir = Join-Path $env:RUNNER_TEMP 'NSIS smoke test\Lumberjack'
$exe = Join-Path $installDir 'Lumberjack.exe'
$profileDir = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'Lumberjack'
if ((Test-Path -LiteralPath $profileDir) -or (Test-Path -LiteralPath $installDir)) {
    throw 'Refusing to use an existing installation or user profile'
}

function Get-Setup([string]$tag) {
    Join-Path $Installers "$tag/Lumberjack-$($tag.Substring(1))-x64-setup.exe"
}
function Invoke-Installer([string]$file, [string]$arguments) {
    $process = Start-Process -FilePath $file -ArgumentList $arguments -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "$file exited with code $($process.ExitCode)" }
}
function Test-Signature([string]$file) {
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') { throw "$file signature: $($signature.Status)" }
    return $signature.SignerCertificate.Thumbprint
}
function Test-InstalledApp([string]$tag, [string]$mode) {
    if (!(Test-Path -LiteralPath (Join-Path $installDir 'resources/app-update.yml') -PathType Leaf)) {
        throw "NSIS installation of $tag is missing app-update.yml"
    }
    node "$PSScriptRoot/smoke-installed-app.mjs" $exe $profileDir $tag $mode
    if ($LASTEXITCODE -ne 0) { throw "Installed application check failed for $tag" }
}

$candidate = Get-Setup $ReleaseTag
if ($RequireSignature) { $signer = Test-Signature $candidate }

# NSIS requires /D to be the last argument, with no quotes even for spaces.
Invoke-Installer (Get-Setup $PreviousTag) "/S /currentuser /D=$installDir"
Test-InstalledApp $PreviousTag 'write'

# Do not pass /D again: the upgrade must find the original install location.
Invoke-Installer $candidate '/S /currentuser --updated'
if ($RequireSignature -and (Test-Signature $exe) -ne $signer) {
    throw 'The installed EXE and setup must have the same valid signing identity'
}
Test-InstalledApp $ReleaseTag 'read'

Invoke-Installer (Join-Path $installDir 'Uninstall Lumberjack.exe') '/S /currentuser'
if (Test-Path -LiteralPath $exe) { throw 'Lumberjack.exe remains after silent uninstall' }
if (!(Test-Path -LiteralPath (Join-Path $profileDir 'settings.json') -PathType Leaf)) {
    throw 'Silent uninstall removed the user settings'
}
Write-Host "Verified install, upgrade ($PreviousTag -> $ReleaseTag), launch and uninstall"

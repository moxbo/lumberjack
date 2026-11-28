param(
    [Parameter(Mandatory)][string]$UnpackedDir,
    [Parameter(Mandatory)][string]$ZipPath
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $UnpackedDir).Path
foreach ($required in 'Lumberjack.exe', 'resources/app.asar', 'resources/app-update.yml') {
    if (!(Test-Path -LiteralPath (Join-Path $root $required) -PathType Leaf)) {
        throw "Missing $required in the NSIS payload"
    }
}

# Omit installer-only files without changing the shared, signed NSIS payload.
$archive = [IO.Compression.ZipFile]::Open($ZipPath, 'Create')
try {
    foreach ($file in [IO.Directory]::EnumerateFiles($root, '*', 'AllDirectories')) {
        $name = [IO.Path]::GetRelativePath($root, $file).Replace('\', '/')
        if ($name -in 'resources/app-update.yml', 'resources/elevate.exe') { continue }
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file, $name, 'NoCompression') | Out-Null
    }
} finally {
    $archive.Dispose()
}

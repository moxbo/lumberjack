# Quick Reference: Icon-Regenerierung bei Bedarf (Windows/PowerShell)

Write-Host "🎨 Lumberjack Icon Regeneration Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptPath

# Check if source PNG exists
$sourceIcon = Join-Path $scriptPath "images\lumberjack_v4_dark_1024.png"
if (-not (Test-Path $sourceIcon)) {
    Write-Host "❌ Error: Source PNG not found at $sourceIcon" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Source PNG found" -ForegroundColor Green
Write-Host ""

# Show options
Write-Host "🔧 Option 1: Using npm script (recommended)" -ForegroundColor Yellow
Write-Host "  npm run icon:generate"
Write-Host ""

Write-Host "🔧 Option 2: Using npx tsx directly" -ForegroundColor Yellow
Write-Host "  npx tsx ./scripts/make-icon.ts"
Write-Host ""

# Run icon generation
Write-Host "Running icon generation..." -ForegroundColor Cyan
Write-Host ""

try {
    & npm run icon:generate

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Icon regeneration successful!" -ForegroundColor Green
        Write-Host ""

        Write-Host "📝 Generated files:" -ForegroundColor Cyan
        Get-Item "images\icon.ico" | ForEach-Object {
            Write-Host "  📄 icon.ico ($($_.Length) bytes)"
        }

        if (Test-Path "images\icon.icns") {
            Get-Item "images\icon.icns" | ForEach-Object {
                Write-Host "  📄 icon.icns ($($_.Length) bytes)"
            }
        }
        else {
            Write-Host "  (icon.icns only generated on macOS)"
        }

        Write-Host ""
        Write-Host "🚀 Next steps:" -ForegroundColor Yellow
        Write-Host "  1. npm run prebuild"
        Write-Host "  2. npm run build:renderer"
        Write-Host "  3. npm start"
        Write-Host ""
    }
    else {
        Write-Host ""
        Write-Host "❌ Icon generation failed!" -ForegroundColor Red
        exit 1
    }
}
catch {
    Write-Host ""
    Write-Host "❌ Error: $_" -ForegroundColor Red
    exit 1
}


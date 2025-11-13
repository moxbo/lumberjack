#!/bin/bash
# Quick Reference: Icon-Regenerierung bei Bedarf

echo "🎨 Lumberjack Icon Regeneration Script"
echo "========================================"
echo ""

cd "$(dirname "$0")" || exit 1

# Check if source PNG exists
if [ ! -f "images/lumberjack_v4_dark_1024.png" ]; then
    echo "❌ Error: Source PNG not found at images/lumberjack_v4_dark_1024.png"
    exit 1
fi

echo "✅ Source PNG found"
echo ""

# Option 1: Use npm script
echo "🔧 Option 1: Using npm script (recommended)"
echo "  npm run icon:generate"
echo ""

# Option 2: Use tsx directly
echo "🔧 Option 2: Using tsx directly"
echo "  npx tsx ./scripts/make-icon.ts"
echo ""

# Choose method
echo "Running icon generation..."
echo ""

if command -v npm &> /dev/null; then
    npm run icon:generate
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Icon regeneration successful!"
        echo ""
        echo "📝 Generated files:"
        ls -lh images/icon.ico
        ls -lh images/icon.icns 2>/dev/null || echo "   (icon.icns only on macOS)"
        echo ""
        echo "🚀 Next steps:"
        echo "  1. npm run prebuild"
        echo "  2. npm run build:renderer"
        echo "  3. npm start"
    else
        echo ""
        echo "❌ Icon generation failed!"
        exit 1
    fi
else
    echo "❌ npm not found. Please install Node.js"
    exit 1
fi


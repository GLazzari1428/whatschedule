#!/bin/bash
set -e  # Exit on any error

echo "Installing dependencies..."
npm install

echo "Installing Capacitor..."
npm install @capacitor/cli@latest @capacitor/core@latest @capacitor/android@latest

echo "Adding Android platform..."
if [ -d "android" ]; then
    echo "WARNING: Android platform already exists. Skipping..."
else
    npx cap add android
    echo "Android platform added"
fi

echo "Syncing Capacitor..."
npx cap sync

echo "Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Open Android Studio: npx cap open android"
echo "  2. Or build APK: npm run cap:build:debug"


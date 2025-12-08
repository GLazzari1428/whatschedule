# Quick Start Guide

## Step 1: Install Dependencies

```bash
npm install
```

This installs all required packages including Capacitor (for Android builds).

## Step 2: Start the Server

```bash
npm start
```

You should see output like:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WhatsScheduler
Server: http://192.168.x.x:3000
Data: /path/to/data
Docker: No
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Note the IP address** - You'll need it for mobile app configuration.

## Step 3: Test in Browser

1. Open browser: `http://localhost:3000`
2. You'll see a config screen (first time) or main app
3. If config screen appears, enter: `http://localhost:3000`
4. Scan QR code with WhatsApp to connect
5. Test all features!

## Step 4: Build Android APK (Optional)

### Prerequisites
- Java JDK 17+ installed
- Android SDK installed (or Android Studio)

### Build Steps

1. **Run setup script**:
   ```bash
   ./setup-android.sh
   ```

2. **Build debug APK**:
   ```bash
   npm run cap:build:debug
   ```

3. **Find APK**: `android/app/build/outputs/apk/debug/app-debug.apk`

4. **Install on device**:
   ```bash
   adb install android/app/build/outputs/apk/debug/app-debug.apk
   ```

## Common Commands

```bash
# Start server
npm start

# Development mode (auto-reload)
npm run dev

# Docker (if using)
npm run docker:up

# Sync web files to Android
npx cap sync

# Open Android project in Android Studio
npx cap open android

# Build Android APK
npm run cap:build:debug
```

## Testing Checklist

### Web App
- [ ] Server starts
- [ ] Browser shows app
- [ ] Config screen works (clear localStorage to test)
- [ ] WhatsApp connects
- [ ] Contacts load
- [ ] Search works
- [ ] Refresh button works
- [ ] Phone numbers display
- [ ] Can schedule messages

### Android App
- [ ] APK builds
- [ ] APK installs
- [ ] App launches
- [ ] Config screen appears
- [ ] Can connect to server
- [ ] All features work

See `TESTING.md` for detailed testing guide.


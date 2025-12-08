# Testing Guide - WhatsApp Scheduler

This guide will help you run and test the application, both as a web app and as an Android APK.

## Part 1: Running the Server

### Option A: Run Locally (Development)

1. **Install dependencies** (if not already done):
   ```bash
   npm install
   ```

2. **Start the server**:
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

3. **Check the output** - You should see:
   ```
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   WhatsScheduler
   Server: http://192.168.x.x:3000
   Data: /path/to/data
   Docker: No
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ```

4. **Note your server IP address** - You'll need this for the mobile app configuration.

### Option B: Run with Docker

1. **Start with Docker Compose**:
   ```bash
   npm run docker:up
   ```

2. **View logs**:
   ```bash
   npm run docker:logs
   ```

3. **Stop Docker**:
   ```bash
   npm run docker:down
   ```

## Part 2: Testing the Web App (Browser)

### Step 1: Access the Web Interface

1. Open your browser and go to: `http://localhost:3000` (or your server IP)
2. You should see the WhatsApp Scheduler interface

### Step 2: Test Server Configuration Screen

1. **Clear localStorage** (to test config screen):
   - Open browser DevTools (F12)
   - Go to Application/Storage tab
   - Clear Local Storage
   - Refresh the page

2. **You should see the config screen** asking for server URL

3. **Enter server URL**:
   - For local testing: `http://localhost:3000`
   - For network testing: `http://YOUR_SERVER_IP:3000`
   - Click "Connect"

4. **Verify connection** - Should redirect to main app

### Step 3: Test WhatsApp Connection

1. **QR Code should appear** if not authenticated
2. **Scan QR code** with WhatsApp:
   - Open WhatsApp on your phone
   - Settings → Linked Devices → Link a Device
   - Scan the QR code

3. **Wait for connection** - Status should change to "WhatsApp connected"

### Step 4: Test Core Features

#### Test Contact Search
- [ ] Type in search box - contacts should filter
- [ ] Search by name - should find contacts
- [ ] Search by phone number - should find contacts
- [ ] Phone numbers display below contact names
- [ ] Groups show "[Group]" label, contacts show "[Contact]" label

#### Test Refresh Button
- [ ] Click refresh button - should show loading animation
- [ ] Button should show "Done" then return to "Refresh"
- [ ] Contact list should update

#### Test Favorites
- [ ] Click star icon on a contact - should add to favorites
- [ ] Favorites section should show the contact
- [ ] Phone number should display in favorites
- [ ] Click star again - should remove from favorites

#### Test Message Scheduling
- [ ] Select a contact from search
- [ ] Type a message
- [ ] Set date and time (24-hour format)
- [ ] Click "Schedule Message(s)"
- [ ] Should see success message
- [ ] Scheduled message should appear in "Scheduled Messages" section

#### Test Multiple Messages
- [ ] Click "Add Another Message"
- [ ] Type multiple messages
- [ ] Schedule them
- [ ] Should see batch with multiple messages

#### Test Scheduled Messages Management
- [ ] View scheduled messages list
- [ ] Delete individual message
- [ ] Delete entire batch
- [ ] Verify messages are removed

### Step 5: Test WebSocket Updates

1. **Open two browser windows** side by side
2. **Schedule a message in one window**
3. **Verify it appears in the other window** automatically (real-time sync)

## Part 3: Testing Android APK

### Prerequisites for Building APK

1. **Java Development Kit (JDK) 17+**
   ```bash
   java -version  # Should show version 17 or higher
   ```

2. **Android Studio** (optional but recommended)
   - Download from: https://developer.android.com/studio
   - Or just install Android SDK command-line tools

3. **Android SDK** - Required for building
   - Set `ANDROID_HOME` environment variable
   - Add `$ANDROID_HOME/platform-tools` to PATH

### Step 1: Setup Android Build Environment

1. **Run the setup script**:
   ```bash
   ./setup-android.sh
   ```

   This will:
   - Install Capacitor dependencies
   - Add Android platform
   - Sync web files to Android project

2. **Verify Android platform was added**:
   ```bash
   ls android/  # Should show Android project structure
   ```

### Step 2: Build Debug APK

**Option A: Using npm script**
```bash
npm run cap:build:debug
```

**Option B: Manual build**
```bash
npx cap sync
cd android
./gradlew assembleDebug
```

**Output location**: `android/app/build/outputs/apk/debug/app-debug.apk`

### Step 3: Install APK on Android Device

**Method 1: Using ADB (Android Debug Bridge)**
```bash
# Connect device via USB
adb devices  # Verify device is connected

# Install APK
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

**Method 2: Manual Installation**
1. Copy APK to your Android device
2. Enable "Install from Unknown Sources" in Android settings
3. Open the APK file on your device
4. Tap "Install"

### Step 4: Test Android App

#### Test Configuration Screen
1. **Open the app** - Should show config screen on first launch
2. **Enter server URL**:
   - For same network: `http://YOUR_SERVER_IP:3000`
   - For localhost testing (if server on same device): `http://10.0.0.2:3000` (Android emulator)
   - For real device: Use your computer's IP address
3. **Test connection** - Should validate and redirect

#### Test All Features (Same as Web)
- [ ] Contact search works
- [ ] Refresh button works
- [ ] Phone numbers display
- [ ] Favorites work
- [ ] Message scheduling works
- [ ] Real-time updates work

#### Test Network Scenarios
- [ ] Same WiFi network - should work
- [ ] Switch from WiFi to mobile data - should reconnect
- [ ] Server offline - should show error (not crash)
- [ ] Server back online - should reconnect automatically

### Step 5: Test on Different Devices

Test on:
- [ ] Android 6.0+ (minimum supported)
- [ ] Different screen sizes
- [ ] Different Android versions

## Part 4: Testing Checklist

### Server Functionality
- [ ] Server starts without errors
- [ ] QR code generates correctly
- [ ] WhatsApp connects successfully
- [ ] Contacts load after connection
- [ ] API endpoints respond correctly
- [ ] WebSocket connections work
- [ ] Messages schedule correctly
- [ ] Messages send at scheduled time
- [ ] Database persists data

### Web App Functionality
- [ ] Config screen appears on first visit
- [ ] Server URL validation works
- [ ] Connection test works
- [ ] Redirect to main app works
- [ ] All features work as expected
- [ ] Responsive design works on mobile browser
- [ ] Dark theme displays correctly

### Android App Functionality
- [ ] APK builds successfully
- [ ] APK installs on device
- [ ] App launches without crashing
- [ ] Config screen appears
- [ ] Server connection works
- [ ] All features work in app
- [ ] App survives being killed and restarted
- [ ] Server URL persists after restart
- [ ] Network changes handled gracefully

### Edge Cases
- [ ] Invalid server URL - shows error
- [ ] Server unreachable - shows error
- [ ] Network timeout - handled gracefully
- [ ] Empty contact list - shows message
- [ ] No scheduled messages - section hidden
- [ ] Past date/time - validation works
- [ ] Empty message - validation works
- [ ] No contact selected - validation works

## Troubleshooting

### Server Won't Start
- Check if port 3000 is already in use
- Verify Node.js version: `node -v` (should be 16+)
- Check for missing dependencies: `npm install`

### Web App Issues
- Clear browser cache and localStorage
- Check browser console for errors (F12)
- Verify CORS headers are set in server.js
- Check network tab for failed requests

### Android Build Issues
- Verify Java version: `java -version` (should be 17+)
- Check Android SDK is installed
- Verify `ANDROID_HOME` environment variable
- Try: `npx cap sync` to refresh files

### Android App Issues
- Check device logs: `adb logcat | grep -i whatscheduler`
- Verify server is accessible from device network
- Check WebView console via Chrome DevTools: `chrome://inspect`
- Clear app data and reconfigure

### Connection Issues
- Verify server IP address is correct
- Check firewall allows port 3000
- Ensure device and server are on same network (for local IPs)
- Test server URL in browser first

## Quick Test Commands

```bash
# Start server
npm start

# Test in browser
curl http://localhost:3000/api/status

# Build Android APK
npm run cap:build:debug

# Check Android device connection
adb devices

# View Android logs
adb logcat | grep -i whatscheduler

# Sync Capacitor (after web changes)
npx cap sync
```

## Next Steps

After testing:
1. Build release APK for distribution (requires signing)
2. Configure GitHub Actions for automated builds
3. Set up production server with HTTPS
4. Configure app signing for Play Store (if publishing)


#!/bin/bash
# Create network security config for Android to allow HTTP connections

ANDROID_RES_XML="android/app/src/main/res/xml"
NETWORK_SECURITY_CONFIG="$ANDROID_RES_XML/network_security_config.xml"

# Create directory if it doesn't exist
mkdir -p "$ANDROID_RES_XML"

# Create network security config
cat > "$NETWORK_SECURITY_CONFIG" << 'EOF'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Allow cleartext (HTTP) traffic for all domains -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
EOF

echo "Network security config created at $NETWORK_SECURITY_CONFIG"


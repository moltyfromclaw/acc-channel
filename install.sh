#!/bin/bash
# ACC Channel Plugin Installer for OpenClaw
# Usage: curl -sL https://raw.githubusercontent.com/moltyfromclaw/acc-channel/main/install.sh | bash

set -e

echo "🦞 ACC Channel Plugin Installer"
echo "================================"

# Check for openclaw
if ! command -v openclaw &> /dev/null; then
    echo "❌ OpenClaw not found. Install it first: npm i -g openclaw"
    exit 1
fi

# Create temp directory
TMPDIR=$(mktemp -d)
cd "$TMPDIR"

echo "📦 Downloading ACC Channel Plugin..."

git clone --depth 1 https://github.com/moltyfromclaw/acc-channel.git
cd acc-channel

echo "🔧 Building plugin..."

# Install dependencies and build
if command -v pnpm &> /dev/null; then
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    pnpm build
elif command -v npm &> /dev/null; then
    npm install
    npm run build
else
    echo "❌ npm or pnpm required"
    exit 1
fi

echo "📥 Installing plugin..."

# Install the plugin
openclaw plugins install .

# Cleanup
cd /
rm -rf "$TMPDIR"

echo ""
echo "✅ ACC Channel Plugin installed!"
echo ""
echo "Next steps:"
echo "1. Configure in openclaw.json:"
echo '   {
     "channels": {
       "acc": {
         "enabled": true,
         "accounts": {
           "default": {
             "serverUrl": "ws://YOUR_ACC_SERVER:3333/channel",
             "agentName": "your-agent-name",
             "token": "your-acc-token"
           }
         }
       }
     }
   }'
echo ""
echo "2. Or set environment variables:"
echo "   export ACC_SERVER_URL=ws://YOUR_ACC_SERVER:3333/channel"
echo "   export ACC_AGENT_NAME=your-agent-name"
echo "   export ACC_TOKEN=your-token"
echo ""
echo "3. Restart the gateway:"
echo "   openclaw gateway restart"
echo ""
echo "4. Verify:"
echo "   openclaw plugins list"
echo "   openclaw channel status acc"

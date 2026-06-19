#!/bin/bash
echo "🚀 Starting WSM-Security Backend..."
echo ""
cd "$(dirname "$0")/backend/functions/server"
node index.js

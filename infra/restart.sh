#!/bin/bash

# Customer Support Portal - PM2 Restart Script

set -e

echo "🔄 Restarting Customer Support Portal"
echo "======================================"

# Restart all PM2 processes
pm2 restart infra/ecosystem.config.js || {
    echo "⚠️  Processes not running. Starting..."
    ./infra/start.sh
    exit 0
}

echo ""
echo "✅ Application restarted"
echo ""
pm2 status


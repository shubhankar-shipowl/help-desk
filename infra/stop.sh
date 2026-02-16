#!/bin/bash

# Customer Support Portal - PM2 Stop Script

set -e

echo "🛑 Stopping Customer Support Portal"
echo "===================================="

# Stop all PM2 processes
pm2 stop infra/ecosystem.config.js 2>/dev/null || pm2 stop all

echo ""
echo "✅ Application stopped"
echo ""
echo "To start again, run: ./infra/start.sh"


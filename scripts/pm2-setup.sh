#!/bin/bash

# PM2 Setup Script for Customer Support Portal

set -e

echo "🚀 Setting up PM2 for Customer Support Portal"
echo "=============================================="

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
  echo "📦 Installing PM2..."
  npm install -g pm2
else
  echo "✅ PM2 is already installed"
  pm2 --version
fi

# Create logs directory
echo "📁 Creating logs directory..."
mkdir -p logs

# Build application
echo "🔨 Building application..."
npm run build

# Stop existing PM2 processes
echo "🛑 Stopping existing PM2 processes..."
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true

# Start with PM2
echo "🚀 Starting application with PM2..."
pm2 start ecosystem.config.js

# Show status
echo ""
echo "📊 PM2 Status:"
pm2 status

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Useful commands:"
echo "  pm2 status          - View status"
echo "  pm2 logs            - View logs"
echo "  pm2 monit           - Monitor in real-time"
echo "  pm2 restart all     - Restart all processes"
echo "  pm2 stop all        - Stop all processes"
echo ""
echo "🔧 Setup auto-start on reboot:"
echo "  pm2 startup"
echo "  pm2 save"
echo ""

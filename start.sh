#!/bin/bash

# Customer Support Portal - PM2 Start Script
# This script starts the application with PM2 (frontend + backend + workers)

set -e

echo "🚀 Starting Customer Support Portal with PM2"
echo "=============================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}⚠️  PM2 is not installed. Installing...${NC}"
    npm install -g pm2
    echo -e "${GREEN}✅ PM2 installed${NC}"
else
    echo -e "${GREEN}✅ PM2 is installed${NC}"
    pm2 --version
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from example...${NC}"
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}✅ Created .env file${NC}"
        echo -e "${YELLOW}⚠️  Please update .env with your configuration${NC}"
    else
        echo -e "${RED}❌ .env.example not found. Please create .env manually${NC}"
        exit 1
    fi
fi

# Generate Prisma client
echo ""
echo "📦 Generating Prisma client..."
npx prisma generate || {
    echo -e "${RED}❌ Failed to generate Prisma client${NC}"
    exit 1
}
echo -e "${GREEN}✅ Prisma client generated${NC}"

# Build the application
echo ""
echo "🔨 Building application..."
npm run build || {
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
}
echo -e "${GREEN}✅ Application built${NC}"

# Create logs directory
echo ""
echo "📁 Creating logs directory..."
mkdir -p logs
echo -e "${GREEN}✅ Logs directory created${NC}"

# Stop existing PM2 processes if running
echo ""
echo "🛑 Stopping existing PM2 processes..."
pm2 stop ecosystem.config.js 2>/dev/null || true
pm2 delete ecosystem.config.js 2>/dev/null || true
echo -e "${GREEN}✅ Cleaned up existing processes${NC}"

# Update PM2 if needed
echo ""
echo "🔄 Updating PM2..."
pm2 update || true

# Make sure wrapper scripts are executable
chmod +x scripts/start-server.sh
chmod +x scripts/start-email-worker.sh
chmod +x scripts/start-push-worker.sh

# Start with PM2
echo ""
echo "🚀 Starting application with PM2..."
pm2 start ecosystem.config.js --env production || {
    echo -e "${RED}❌ Failed to start PM2 processes${NC}"
    echo -e "${YELLOW}💡 Check logs: pm2 logs${NC}"
    exit 1
}

# Wait a moment for processes to start
sleep 2

# Show status
echo ""
echo -e "${GREEN}📊 PM2 Status:${NC}"
pm2 status

echo ""
echo -e "${GREEN}✅ Application started successfully!${NC}"
echo ""
echo "📋 Useful Commands:"
echo "  pm2 status          - View process status"
echo "  pm2 logs            - View all logs"
echo "  pm2 logs support-portal - View main app logs"
echo "  pm2 monit           - Real-time monitoring"
echo ""
echo "🔌 Application Ports:"
echo "  Main App Port:      3002 (internal)"
echo "  Nginx HTTP:         80 (external)"
echo "  Nginx HTTPS:        443 (external)"
echo "  WebSocket:          Same as main app (3002)"
echo ""
echo "🌐 Access your application:"
echo "  Frontend: https://support.shipowl.io"
echo "  API: https://support.shipowl.io/api"
echo "  WebSocket: wss://support.shipowl.io/socket.io/"
echo "  Local (if accessible): http://localhost:3002"
echo ""
echo "💡 To setup auto-start on reboot:"
echo "  pm2 startup"
echo "  pm2 save"
echo ""


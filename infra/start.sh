#!/bin/bash

# Customer Support Portal - PM2 Start Script
# Starts the frontend + all microservices with PM2

set -e

echo "Starting Customer Support Portal with PM2"
echo "=============================================="

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# Check if PM2 is installed
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 is not installed. Installing...${NC}"
    npm install -g pm2
    echo -e "${GREEN}PM2 installed${NC}"
else
    echo -e "${GREEN}PM2 is installed${NC}"
    pm2 --version
fi

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}.env file not found. Creating from example...${NC}"
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "${GREEN}Created .env file${NC}"
        echo -e "${YELLOW}Please update .env with your configuration${NC}"
    else
        echo -e "${RED}.env.example not found. Please create .env manually${NC}"
        exit 1
    fi
fi

# Source .env for build variables
set -a
source .env 2>/dev/null || true
set +a

# Install shared package dependencies
echo ""
echo "Installing shared package dependencies..."
cd "$PROJECT_ROOT/packages/shared"
npm install || {
    echo -e "${RED}Failed to install shared package dependencies${NC}"
    exit 1
}
echo -e "${GREEN}Shared package dependencies installed${NC}"

# Generate Prisma client
echo ""
echo "Generating Prisma client..."
npx prisma generate || {
    echo -e "${RED}Failed to generate Prisma client${NC}"
    exit 1
}
echo -e "${GREEN}Prisma client generated${NC}"

# Build frontend
echo ""
echo "Building frontend..."
cd "$PROJECT_ROOT/frontend"
if [ -z "$NEXT_PUBLIC_WS_URL" ]; then
    export NEXT_PUBLIC_WS_URL="${APP_URL:-http://localhost:3002}"
    echo -e "${YELLOW}Setting NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}${NC}"
fi
npm install && npm run build || {
    echo -e "${RED}Frontend build failed${NC}"
    exit 1
}
echo -e "${GREEN}Frontend built${NC}"

# Build all microservices
SERVICES=("email-service" "notification-service" "calling-service" "facebook-service" "order-tracking-service")

for SERVICE in "${SERVICES[@]}"; do
    echo ""
    echo "Building ${SERVICE}..."
    cd "$PROJECT_ROOT/services/${SERVICE}"
    npm install && npm run build || {
        echo -e "${RED}Failed to build ${SERVICE}${NC}"
        exit 1
    }
    echo -e "${GREEN}${SERVICE} built${NC}"
done

cd "$PROJECT_ROOT"

# Create logs directory
echo ""
echo "Creating logs directory..."
mkdir -p logs
echo -e "${GREEN}Logs directory created${NC}"

# Stop existing PM2 processes if running
echo ""
echo "Stopping existing PM2 processes..."
pm2 stop infra/ecosystem.config.js 2>/dev/null || true
pm2 delete infra/ecosystem.config.js 2>/dev/null || true
echo -e "${GREEN}Cleaned up existing processes${NC}"

# Update PM2 if needed
echo ""
echo "Updating PM2..."
pm2 update || true

# Make sure wrapper scripts are executable
chmod +x scripts/start-server.sh 2>/dev/null || true

# Start with PM2
echo ""
echo "Starting application with PM2..."
pm2 start infra/ecosystem.config.js --env production || {
    echo -e "${RED}Failed to start PM2 processes${NC}"
    echo -e "${YELLOW}Check logs: pm2 logs${NC}"
    exit 1
}

# Wait a moment for processes to start
sleep 3

# Show status
echo ""
echo -e "${GREEN}PM2 Status:${NC}"
pm2 status

echo ""
echo -e "${GREEN}Application started successfully!${NC}"
echo ""
echo "Useful Commands:"
echo "  pm2 status                      - View process status"
echo "  pm2 logs                        - View all logs"
echo "  pm2 logs support-portal         - View frontend logs"
echo "  pm2 logs email-service          - View email service logs"
echo "  pm2 logs notification-service   - View notification service logs"
echo "  pm2 logs calling-service        - View calling service logs"
echo "  pm2 logs facebook-service       - View facebook service logs"
echo "  pm2 logs order-tracking-service - View order tracking logs"
echo "  pm2 monit                       - Real-time monitoring"
echo ""
echo "Service Ports:"
echo "  Frontend (Next.js):      3002"
echo "  Email Service:           3003"
echo "  Notification Service:    3004 (WebSocket + Push/Email workers)"
echo "  Calling Service:         3005"
echo "  Facebook Service:        3006"
echo "  Order Tracking Service:  3007"
echo "  Nginx HTTP:              80"
echo "  Nginx HTTPS:             443"
echo ""
echo "Health Checks:"
echo "  curl http://localhost:3003/health"
echo "  curl http://localhost:3004/health"
echo "  curl http://localhost:3005/health"
echo "  curl http://localhost:3006/health"
echo "  curl http://localhost:3007/health"
echo ""
echo "Auto-start on reboot:"
echo "  pm2 startup"
echo "  pm2 save"
echo ""

#!/bin/bash

# Quick Configuration Script for Customer Support Portal
# Usage: ./QUICK_CONFIG.sh yourdomain.com your-email@example.com

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: ./QUICK_CONFIG.sh <domain> <email>"
  echo "Example: ./QUICK_CONFIG.sh example.com admin@example.com"
  exit 1
fi

DOMAIN=$1
EMAIL=$2

echo "🚀 Configuring Customer Support Portal"
echo "======================================"
echo "Domain: $DOMAIN"
echo "Email: $EMAIL"
echo ""

# Step 1: Update domain in config files
echo "📝 Step 1: Updating domain in config files..."
if [ -f "scripts/update-domain.sh" ]; then
  ./scripts/update-domain.sh $DOMAIN
else
  echo "⚠️  Update script not found, updating manually..."
  sed -i '' "s/yourdomain.com/$DOMAIN/g" nginx/conf.d/support-portal.conf 2>/dev/null || true
  sed -i '' "s/yourdomain.com/$DOMAIN/g" docker-compose.prod.yml 2>/dev/null || true
  sed -i '' "s/yourdomain.com/$DOMAIN/g" init-letsencrypt.sh 2>/dev/null || true
fi
echo "✅ Domain updated"

# Step 2: Update email in SSL script
echo "📝 Step 2: Updating email in SSL script..."
sed -i '' "s/your-email@example.com/$EMAIL/g" init-letsencrypt.sh 2>/dev/null || true
echo "✅ Email updated"

# Step 3: Create .env.production if doesn't exist
echo "📝 Step 3: Setting up environment variables..."
if [ ! -f ".env.production" ]; then
  if [ -f ".env.production.example" ]; then
    cp .env.production.example .env.production
    echo "✅ Created .env.production from example"
  else
    echo "⚠️  .env.production.example not found"
  fi
fi

# Update URLs in .env.production
if [ -f ".env.production" ]; then
  sed -i '' "s|https://yourdomain.com|https://$DOMAIN|g" .env.production 2>/dev/null || true
  sed -i '' "s|wss://yourdomain.com|wss://$DOMAIN|g" .env.production 2>/dev/null || true
  echo "✅ Updated URLs in .env.production"
fi

echo ""
echo "✅ Configuration complete!"
echo ""
echo "📋 Next steps:"
echo "1. Configure DNS records:"
echo "   - A record: @ → Your server IP"
echo "   - A record: www → Your server IP"
echo ""
echo "2. Wait for DNS propagation (5-10 minutes)"
echo ""
echo "3. Run setup script:"
echo "   sudo ./scripts/setup-nginx.sh"
echo ""
echo "4. Or for Docker:"
echo "   ./init-letsencrypt.sh"
echo "   docker-compose -f docker-compose.prod.yml up -d"
echo ""
echo "5. Build and start application:"
echo "   npm run build"
echo "   npm start"
echo ""

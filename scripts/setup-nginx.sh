#!/bin/bash

# Nginx Setup Script for Customer Support Portal
# This script helps set up Nginx with SSL on the host system

set -e

echo "🚀 Setting up Nginx for Customer Support Portal"
echo "================================================"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
  echo "❌ Please run as root (use sudo)"
  exit 1
fi

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install Nginx
echo "📦 Installing Nginx..."
apt install nginx -y

# Install Certbot
echo "📦 Installing Certbot..."
apt install certbot python3-certbot-nginx -y

# Get domain name
read -p "Enter your domain name (e.g., example.com): " DOMAIN
read -p "Enter your email for SSL certificate: " EMAIL

# Update Nginx config with domain
if [ -f "nginx/conf.d/support-portal.conf" ]; then
  echo "📝 Updating Nginx configuration with domain..."
  sed -i "s/yourdomain.com/$DOMAIN/g" nginx/conf.d/support-portal.conf
  
  # Copy config to Nginx sites
  cp nginx/conf.d/support-portal.conf /etc/nginx/sites-available/support-portal.conf
  ln -sf /etc/nginx/sites-available/support-portal.conf /etc/nginx/sites-enabled/
  
  # Remove default site
  rm -f /etc/nginx/sites-enabled/default
  
  # Test configuration
  echo "🧪 Testing Nginx configuration..."
  nginx -t
  
  if [ $? -eq 0 ]; then
    echo "✅ Nginx configuration is valid"
  else
    echo "❌ Nginx configuration has errors"
    exit 1
  fi
else
  echo "⚠️  Nginx config file not found. Please ensure nginx/conf.d/support-portal.conf exists"
fi

# Configure firewall
echo "🔥 Configuring firewall..."
ufw allow 'Nginx Full'
ufw allow OpenSSH
ufw --force enable

# Start Nginx
echo "🚀 Starting Nginx..."
systemctl start nginx
systemctl enable nginx

# Obtain SSL certificate
echo "🔐 Obtaining SSL certificate..."
certbot --nginx \
  -d $DOMAIN \
  -d www.$DOMAIN \
  --email $EMAIL \
  --agree-tos \
  --non-interactive \
  --redirect

# Test SSL renewal
echo "🧪 Testing SSL certificate renewal..."
certbot renew --dry-run

# Reload Nginx
echo "🔄 Reloading Nginx..."
systemctl reload nginx

echo ""
echo "✅ Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Update your .env.production file with:"
echo "   APP_URL=https://$DOMAIN"
echo "   NEXTAUTH_URL=https://$DOMAIN"
echo "   NEXT_PUBLIC_WS_URL=wss://$DOMAIN"
echo ""
echo "2. Configure DNS records:"
echo "   A record: @ → Your server IP"
echo "   A record: www → Your server IP"
echo ""
echo "3. Start your Next.js application:"
echo "   npm run build"
echo "   npm start"
echo ""
echo "4. Visit your site: https://$DOMAIN"
echo ""


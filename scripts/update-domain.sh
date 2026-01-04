#!/bin/bash

# Script to update domain name in all configuration files

if [ -z "$1" ]; then
  echo "Usage: ./update-domain.sh yourdomain.com"
  exit 1
fi

DOMAIN=$1
OLD_DOMAIN="yourdomain.com"

echo "🔄 Updating domain from $OLD_DOMAIN to $DOMAIN..."

# Update Nginx config
if [ -f "nginx/conf.d/support-portal.conf" ]; then
  sed -i.bak "s/$OLD_DOMAIN/$DOMAIN/g" nginx/conf.d/support-portal.conf
  echo "✅ Updated nginx/conf.d/support-portal.conf"
fi

# Update Docker Compose
if [ -f "docker-compose.prod.yml" ]; then
  sed -i.bak "s/$OLD_DOMAIN/$DOMAIN/g" docker-compose.prod.yml
  echo "✅ Updated docker-compose.prod.yml"
fi

# Update SSL init script
if [ -f "init-letsencrypt.sh" ]; then
  sed -i.bak "s/$OLD_DOMAIN/$DOMAIN/g" init-letsencrypt.sh
  echo "✅ Updated init-letsencrypt.sh"
fi

echo ""
echo "✅ Domain updated successfully!"
echo ""
echo "📝 Don't forget to:"
echo "1. Update .env.production with your domain"
echo "2. Configure DNS records"
echo "3. Run SSL certificate setup"
echo ""


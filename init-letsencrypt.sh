#!/bin/bash

# Replace with your actual values
domains=(support.shipowl.io www.support.shipowl.io)
email="your-email@example.com"
staging=0 # Set to 1 for testing

# Download recommended TLS parameters
if [ ! -e "./certbot/conf/options-ssl-nginx.conf" ]; then
  echo "### Downloading recommended TLS parameters ..."
  mkdir -p ./certbot/conf
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > ./certbot/conf/options-ssl-nginx.conf
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > ./certbot/conf/ssl-dhparams.pem
  echo
fi

# Create dummy certificate for nginx to start
echo "### Creating dummy certificate for $domains ..."
path="/etc/letsencrypt/live/${domains[0]}"
mkdir -p "./certbot/conf/live/${domains[0]}"
docker-compose -f docker-compose.prod.yml run --rm --entrypoint "\
  openssl req -x509 -nodes -newkey rsa:4096 -days 1\
    -keyout '$path/privkey.pem' \
    -out '$path/fullchain.pem' \
    -subj '/CN=localhost'" certbot
echo

# Start nginx
echo "### Starting nginx ..."
docker-compose -f docker-compose.prod.yml up --force-recreate -d nginx
echo

# Delete dummy certificate
echo "### Deleting dummy certificate for $domains ..."
docker-compose -f docker-compose.prod.yml run --rm --entrypoint "\
  rm -Rf /etc/letsencrypt/live/${domains[0]} && \
  rm -Rf /etc/letsencrypt/archive/${domains[0]} && \
  rm -Rf /etc/letsencrypt/renewal/${domains[0]}.conf" certbot
echo

# Request Let's Encrypt certificate
echo "### Requesting Let's Encrypt certificate for $domains ..."
domain_args=""
for domain in "${domains[@]}"; do
  domain_args="$domain_args -d $domain"
done

# Select appropriate email arg
case "$email" in
  "") email_arg="--register-unsafely-without-email" ;;
  *) email_arg="--email $email" ;;
esac

# Enable staging mode if needed
if [ $staging != "0" ]; then staging_arg="--staging"; fi

docker-compose -f docker-compose.prod.yml run --rm --entrypoint "\
  certbot certonly --webroot -w /var/www/certbot \
    $staging_arg \
    $email_arg \
    $domain_args \
    --rsa-key-size 4096 \
    --agree-tos \
    --force-renewal" certbot
echo

# Reload nginx
echo "### Reloading nginx ..."
docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload


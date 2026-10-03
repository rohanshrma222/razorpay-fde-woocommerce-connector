#!/bin/sh
set -e
WP="wp --path=/var/www/html --allow-root"

echo "Waiting for database connection..."
until $WP db check --skip-ssl >/dev/null 2>&1; do
  echo "  ...database/WordPress not ready yet, retrying in 3s"
  sleep 3
done
echo "Database is ready."

if $WP core is-installed >/dev/null 2>&1; then
  echo "WordPress already installed, skipping core install."
else
  echo "Installing WordPress core..."
  $WP core install \
    --url="http://localhost:8080" \
    --title="MCP Demo Store" \
    --admin_user="admin" \
    --admin_password="admin123" \
    --admin_email="admin@example.test" \
    --skip-email
fi

if $WP plugin is-installed woocommerce >/dev/null 2>&1; then
  echo "WooCommerce already installed."
  $WP plugin is-active woocommerce >/dev/null 2>&1 || $WP plugin activate woocommerce
else
  echo "Installing WooCommerce..."
  $WP plugin install woocommerce --activate
fi

$WP rewrite structure '/%postname%/'
$WP rewrite flush

echo "Seeding fictional products/orders and generating API credentials..."
$WP eval-file /seed.php

echo ""
echo "=================================================="
echo " Setup complete."
echo " Store running at: http://localhost:8080"
echo " wp-admin login:   admin / admin123 (local dev only)"
echo ""
echo " Copy the CONSUMER_KEY / CONSUMER_SECRET printed"
echo " above into your .env as:"
echo "   WC_SITE_URL=http://localhost:8080"
echo "   WC_CONSUMER_KEY=<printed key>"
echo "   WC_CONSUMER_SECRET=<printed secret>"
echo "=================================================="

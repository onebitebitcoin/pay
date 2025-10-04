#!/usr/bin/env bash

set -euo pipefail

# Deployment script for the Pay (bitcoin-store) project
# Inspired by ../playground/deploy.sh but adapted for a Node.js backend + CRA frontend.
#
# Usage:
#   SERVER_NAME=pay.example.com BACKEND_PORT=8003 sudo -E ./deploy.sh
#
# Environment variables:
#   SERVER_NAME   Fully qualified domain for nginx (default: pay.onebitebitcoin.com)
#   BACKEND_PORT  Port used by the Node backend (default: 8003)
#   DEPLOY_USER   System user that will run the backend service (default: current $USER)
#   NODE_ENV      Node environment for the backend (default: production)

PROJECT_NAME="pay"
ROOT_DIR=$(pwd)
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
FRONTEND_DEPLOY_DIR="/var/www/${PROJECT_NAME}"
SERVICE_NAME="${PROJECT_NAME}-backend"
BACKEND_PORT="${BACKEND_PORT:-8003}"
SERVER_NAME="${SERVER_NAME:-pay.onebitebitcoin.com}"
DEPLOY_USER="${DEPLOY_USER:-$USER}"
NODE_ENV="${NODE_ENV:-production}"
ENV_FILE="/etc/${PROJECT_NAME}.env"
NGINX_SITE_NAME="pay.onebitebitcoin.com"
NGINX_CONF="/etc/nginx/sites-available/${NGINX_SITE_NAME}"
LOG_FILE="/var/log/${PROJECT_NAME}-backend.log"

USE_SSL=false
if [ -n "$SERVER_NAME" ] && [ -f "/etc/letsencrypt/live/${SERVER_NAME}/fullchain.pem" ]; then
  USE_SSL=true
fi

cat <<INFO
=== Deploying ${PROJECT_NAME} ===
Root dir:          ${ROOT_DIR}
Backend dir:       ${BACKEND_DIR}
Frontend dir:      ${FRONTEND_DIR}
Deploy dir:        ${FRONTEND_DEPLOY_DIR}
Service name:      ${SERVICE_NAME}
Backend port:      ${BACKEND_PORT}
Server name:       ${SERVER_NAME}
Deploy user:       ${DEPLOY_USER}
Node env:          ${NODE_ENV}
nginx conf:        ${NGINX_CONF}
Env file (opt.):   ${ENV_FILE}
SSL enabled:       ${USE_SSL}
INFO

if [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run with sudo (it modifies system packages/services)." >&2
  exit 1
fi

# Ensure the DEPLOY_USER exists
if ! id -u "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "Deploy user ${DEPLOY_USER} does not exist. Create it first or set DEPLOY_USER." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "=== Updating system packages ==="
apt update -y
apt upgrade -y

echo "=== Installing required dependencies (Node.js, build tools, nginx) ==="
apt install -y curl wget git build-essential python3 python3-pip python3-venv nginx pkg-config

if ! command -v node >/dev/null 2>&1; then
  echo "Installing Node.js LTS..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  apt install -y nodejs
fi

systemctl enable nginx
systemctl start nginx

if command -v ufw >/dev/null 2>&1; then
  echo "Configuring UFW..."
  ufw allow ssh || true
  ufw allow 'Nginx Full' || true
  ufw --force enable || true
fi

mkdir -p "$FRONTEND_DEPLOY_DIR"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$FRONTEND_DEPLOY_DIR"

if [ ! -d "$BACKEND_DIR" ] || [ ! -f "$BACKEND_DIR/package.json" ]; then
  echo "Backend directory/package.json not found; aborting." >&2
  exit 1
fi

if [ ! -d "$FRONTEND_DIR" ] || [ ! -f "$FRONTEND_DIR/package.json" ]; then
  echo "Frontend directory/package.json not found; aborting." >&2
  exit 1
fi

su - "$DEPLOY_USER" -c "cd '$BACKEND_DIR' && npm install --omit=dev --no-audit"

cat <<SERVICE | tee /etc/systemd/system/${SERVICE_NAME}.service >/dev/null
[Unit]
Description=Pay Backend (Node.js)
After=network.target

[Service]
Type=simple
WorkingDirectory=${BACKEND_DIR}
Environment=NODE_ENV=${NODE_ENV}
Environment=PORT=${BACKEND_PORT}
EnvironmentFile=-${ENV_FILE}
ExecStart=/usr/bin/env node server.js
Restart=always
RestartSec=5
User=${DEPLOY_USER}
Group=${DEPLOY_USER}
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}

[Install]
WantedBy=multi-user.target
SERVICE

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chown "$DEPLOY_USER":"$DEPLOY_USER" "$LOG_FILE"
chmod 640 "$LOG_FILE"

systemctl daemon-reload
systemctl enable ${SERVICE_NAME}
systemctl restart ${SERVICE_NAME}

su - "$DEPLOY_USER" -c "cd '$FRONTEND_DIR' && npm install --no-audit"
su - "$DEPLOY_USER" -c "cd '$FRONTEND_DIR' && npm run build"

rsync -a --delete "$FRONTEND_DIR/build/" "$FRONTEND_DEPLOY_DIR/"
chown -R www-data:www-data "$FRONTEND_DEPLOY_DIR"
chmod -R 755 "$FRONTEND_DEPLOY_DIR"

if [ "$USE_SSL" = true ]; then
  TLS_CERT="/etc/letsencrypt/live/${SERVER_NAME}/fullchain.pem"
  TLS_KEY="/etc/letsencrypt/live/${SERVER_NAME}/privkey.pem"
else
  TLS_CERT=""
  TLS_KEY=""
fi

cat <<'EOF_CONF' | sed "s#__SERVER_NAME__#${SERVER_NAME}#g" | \
sed "s#__DEPLOY_DIR__#${FRONTEND_DEPLOY_DIR}#g" | \
sed "s#__BACKEND_PORT__#${BACKEND_PORT}#g" | \
sed "s#__TLS_CERT__#${TLS_CERT}#g" | \
sed "s#__TLS_KEY__#${TLS_KEY}#g" | \
sed "s#__USE_SSL__#${USE_SSL}#g" > "$NGINX_CONF"
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF_CONF

if [ "$USE_SSL" = true ]; then
  cat <<'EOF_SSL' | sed "s#__SERVER_NAME__#${SERVER_NAME}#g" | \
  sed "s#__DEPLOY_DIR__#${FRONTEND_DEPLOY_DIR}#g" | \
  sed "s#__BACKEND_PORT__#${BACKEND_PORT}#g" | \
  sed "s#__TLS_CERT__#${TLS_CERT}#g" | \
  sed "s#__TLS_KEY__#${TLS_KEY}#g" >> "$NGINX_CONF"
server {
    listen 443 ssl http2;
    server_name __SERVER_NAME__;

    ssl_certificate __TLS_CERT__;
    ssl_certificate_key __TLS_KEY__;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root __DEPLOY_DIR__;
    index index.html;

    client_max_body_size 20m;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:__BACKEND_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /status/health {
        proxy_pass http://127.0.0.1:__BACKEND_PORT__/health;
        proxy_set_header Host $host;
    }
}

server {
    listen 80;
    server_name __SERVER_NAME__;
    return 301 https://$host$request_uri;
}
EOF_SSL
else
  cat <<'EOF_HTTP' | sed "s#__SERVER_NAME__#${SERVER_NAME}#g" | \
  sed "s#__DEPLOY_DIR__#${FRONTEND_DEPLOY_DIR}#g" | \
  sed "s#__BACKEND_PORT__#${BACKEND_PORT}#g" | \
  sed "s#__TLS_CERT__#${TLS_CERT}#g" | \
  sed "s#__TLS_KEY__#${TLS_KEY}#g" >> "$NGINX_CONF"
server {
    listen 80;
    server_name __SERVER_NAME__;

    root __DEPLOY_DIR__;
    index index.html;

    client_max_body_size 20m;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:__BACKEND_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /status/health {
        proxy_pass http://127.0.0.1:__BACKEND_PORT__/health;
        proxy_set_header Host $host;
    }
}
EOF_HTTP
fi

ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

sleep 2

BACKEND_ACTIVE="inactive"
if systemctl is-active --quiet ${SERVICE_NAME}; then
  BACKEND_ACTIVE="active"
fi

HEALTH_STATUS=1
if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
  HEALTH_STATUS=0
fi

cat <<SUMMARY

=== Deployment Summary ===
Backend service: ${SERVICE_NAME} (${BACKEND_ACTIVE})
Backend port:    ${BACKEND_PORT}
Backend logs:    sudo journalctl -u ${SERVICE_NAME} -f
Backend env:     ${ENV_FILE} (optional)
Frontend path:   ${FRONTEND_DEPLOY_DIR}
nginx config:    ${NGINX_CONF}
Server name:     ${SERVER_NAME}
SSL enabled:     ${USE_SSL}
Health check:    $( [ ${HEALTH_STATUS} -eq 0 ] && echo "OK" || echo "FAILED" )

Next steps:
  - Ensure DNS for ${SERVER_NAME} points to this host.
  - Populate ${ENV_FILE} with secrets (if needed) and re-run this script.
  - For HTTPS (if not already), run: sudo certbot --nginx -d ${SERVER_NAME}
SUMMARY

exit 0

#!/bin/bash
# ═══════════════════════════════════════════════════════
# REFINERY NEXUS — Linode Server Setup Script
# Run this on a fresh Ubuntu 24.04 LTS Linode instance
# Usage: chmod +x setup-linode.sh && ./setup-linode.sh
# ═══════════════════════════════════════════════════════

set -e

echo "╔═══════════════════════════════════════╗"
echo "║   REFINERY NEXUS — SERVER SETUP       ║"
echo "╚═══════════════════════════════════════╝"

# ── 1. System Updates ──
echo "[1/6] Updating system packages..."
apt update -y && apt upgrade -y
apt install -y curl wget gnupg2 unzip git htop ufw

# ── 2. Firewall Setup ──
echo "[2/6] Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP
ufw allow 443/tcp     # HTTPS
ufw allow 4000/tcp    # Backend API
ufw allow 8123/tcp    # ClickHouse HTTP (local only in prod)
ufw --force enable
echo "✓ Firewall configured"

# ── 3. Install Node.js 22 LTS ──
echo "[3/6] Installing Node.js 22 LTS..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
npm install -g pm2
echo "✓ Node.js $(node --version) installed"
echo "✓ PM2 process manager installed"

# ── 4. Install ClickHouse ──
echo "[4/6] Installing ClickHouse..."
curl -fsSL 'https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key' | gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main" | tee /etc/apt/sources.list.d/clickhouse.list
apt update -y
# Install with empty default password (we'll set it later)
DEBIAN_FRONTEND=noninteractive apt install -y clickhouse-server clickhouse-client

# Start ClickHouse
systemctl enable clickhouse-server
systemctl start clickhouse-server
echo "✓ ClickHouse installed and running"

# ── 5. Create app directory ──
echo "[5/6] Setting up application directory..."
mkdir -p /opt/refinery-nexus
chown -R root:root /opt/refinery-nexus

# ── 6. Create systemd service for the backend ──
echo "[6/6] Creating systemd service..."
cat > /etc/systemd/system/refinery-backend.service << 'EOF'
[Unit]
Description=Refinery Nexus Backend API
After=network.target clickhouse-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/refinery-nexus/refinery-backend
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/refinery-nexus/refinery-backend/.env

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
echo "✓ Systemd service created"

# ── Done ──
echo ""
echo "╔═══════════════════════════════════════════════════╗"
echo "║              SETUP COMPLETE!                      ║"
echo "╠═══════════════════════════════════════════════════╣"
echo "║ Node.js:    $(node --version)                            ║"
echo "║ ClickHouse: $(clickhouse-client --version 2>/dev/null | head -1 | awk '{print $3}')                           ║"
echo "║ PM2:        $(pm2 --version 2>/dev/null)                            ║"
echo "╠═══════════════════════════════════════════════════╣"
echo "║ Next Steps:                                       ║"
echo "║ 1. Copy refinery-backend to /opt/refinery-nexus/  ║"
echo "║ 2. Create .env from .env.example                  ║"
echo "║ 3. npm install && npm run build                   ║"
echo "║ 4. npm run db:init                                ║"
echo "║ 5. systemctl start refinery-backend               ║"
echo "╚═══════════════════════════════════════════════════╝"

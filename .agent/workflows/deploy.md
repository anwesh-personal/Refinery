---
description: How to deploy Refinery Nexus on a dedicated Ubuntu server
---

# Deploying Refinery Nexus — Full Stack on Ubuntu 24.04

**Server:** RackNerd Dedicated
**Specs:** 32GB RAM · 500GB SSD · 2TB SATA (500GB partitioned for MinIO)
**Stack:** ClickHouse + MinIO + Node.js Backend + Nginx

> Supabase stays as a managed cloud service (auth, profiles, teams, roles, servers tables).
> Frontend can be self-hosted on same box behind Nginx, or deployed to Vercel.

---

## 1. Initial Server Setup

```bash
# SSH in as root, then create a deploy user
adduser deploy
usermod -aG sudo deploy

# Switch to deploy user for everything below
su - deploy

# Update system
sudo apt update && sudo apt upgrade -y

# Install essentials
sudo apt install -y curl wget git ufw fail2ban htop unzip
```

## 2. Firewall (UFW)

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
# DO NOT expose ClickHouse (8123, 9000) or MinIO (9000/9001) directly
sudo ufw enable
```

## 3. Mount & Format the SATA Disk

```bash
# Identify the SATA disk and the MinIO partition
lsblk

# Example: /dev/sdb1 is your 500GB MinIO partition
# Format if not already done:
sudo mkfs.ext4 /dev/sdb1

# Create mount point
sudo mkdir -p /mnt/minio-data

# Mount it
sudo mount /dev/sdb1 /mnt/minio-data

# Make it persist on reboot — add to /etc/fstab
echo "$(sudo blkid -s UUID -o value /dev/sdb1) /mnt/minio-data ext4 defaults 0 2" | sudo tee -a /etc/fstab

# Give deploy user ownership
sudo chown -R deploy:deploy /mnt/minio-data
```

## 4. Install ClickHouse

```bash
sudo apt-get install -y apt-transport-https ca-certificates
curl -fsSL https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key | sudo gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main" | sudo tee /etc/apt/sources.list.d/clickhouse.list
sudo apt-get update
sudo apt-get install -y clickhouse-server clickhouse-client

# It will prompt for a password — SET ONE
sudo systemctl enable clickhouse-server
sudo systemctl start clickhouse-server

# Verify
clickhouse-client --password YOUR_PASSWORD -q "SELECT version()"
```

### ClickHouse Config Tuning (32GB server)

Edit `/etc/clickhouse-server/config.xml`:
```xml
<!-- Listen only on localhost -->
<listen_host>127.0.0.1</listen_host>
<http_port>8123</http_port>
```

Edit `/etc/clickhouse-server/users.xml`:
```xml
<profiles>
    <default>
        <!-- Leave ~8GB for OS + Node.js + MinIO -->
        <max_memory_usage>24000000000</max_memory_usage>  <!-- 24GB -->
        <max_execution_time>300</max_execution_time>
    </default>
</profiles>
```

```bash
sudo systemctl restart clickhouse-server
```

## 5. Install MinIO

```bash
# Download MinIO server binary
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# Download MinIO client (mc) for bucket management
wget https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc
sudo mv mc /usr/local/bin/

# Create a dedicated system user for MinIO
sudo useradd -r -s /sbin/nologin minio-user
sudo chown -R minio-user:minio-user /mnt/minio-data
```

### Create MinIO environment file:

```bash
sudo tee /etc/default/minio << 'EOF'
# MinIO root credentials — CHANGE THESE
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=STRONG_PASSWORD_HERE

# Data directory (on your 500GB SATA partition)
MINIO_VOLUMES="/mnt/minio-data"

# Bind to localhost only (Nginx will proxy)
MINIO_OPTS="--console-address :9001 --address 127.0.0.1:9000"
EOF
```

### Create MinIO systemd service:

```bash
sudo tee /etc/systemd/system/minio.service << 'EOF'
[Unit]
Description=MinIO Object Storage
After=network.target

[Service]
User=minio-user
Group=minio-user
EnvironmentFile=/etc/default/minio
ExecStart=/usr/local/bin/minio server $MINIO_OPTS $MINIO_VOLUMES
Restart=always
RestartSec=10
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable minio
sudo systemctl start minio

# Verify
sudo systemctl status minio
```

### Create the refinery-data bucket:

```bash
# Configure mc alias
mc alias set local http://127.0.0.1:9000 minioadmin STRONG_PASSWORD_HERE

# Create the bucket
mc mb local/refinery-data

# Verify
mc ls local
```

## 6. Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version   # v20.x
```

## 7. Install PM2

```bash
sudo npm install -g pm2
pm2 startup systemd
# Run the command it outputs
```

## 8. Clone & Configure Backend

```bash
cd /home/deploy
git clone https://github.com/anwesh-personal/Refinery.git refinery
cd refinery/refinery-backend
npm install
```

### Create `.env` file:

```bash
cat > .env << 'EOF'
NODE_ENV=production
PORT=4000

# ClickHouse (localhost — same machine)
CLICKHOUSE_HOST=http://127.0.0.1:8123
CLICKHOUSE_DATABASE=refinery
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=YOUR_CLICKHOUSE_PASSWORD

# Supabase (cloud)
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=eyJ...anon-key...
SUPABASE_SECRET_KEY=eyJ...service-role-key...

# Frontend URL (for CORS)
FRONTEND_URL=https://your-domain.com

# MinIO Object Storage (self-hosted)
OBJ_STORAGE_ENDPOINT=http://127.0.0.1:9000
OBJ_STORAGE_BUCKET=refinery-data
OBJ_STORAGE_ACCESS_KEY=minioadmin
OBJ_STORAGE_SECRET_KEY=STRONG_PASSWORD_HERE

# S3 Source bucket (the 5x5 feed — keep if still used)
# S3_SOURCE_BUCKET=...
# S3_SOURCE_REGION=us-east-1
# S3_SOURCE_ACCESS_KEY=...
# S3_SOURCE_SECRET_KEY=...

# Verify550 (optional)
# VERIFY550_ENDPOINT=https://api.verify550.com/v1
# VERIFY550_API_KEY=v550-key-xxx
EOF
```

### Build & Start:

```bash
npm run build
pm2 start dist/index.js --name refinery-api
pm2 save

# Verify
curl http://localhost:4000/api/health
```

## 9. Install Nginx + SSL

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

### Nginx config (API + MinIO Console + Frontend):

```bash
sudo tee /etc/nginx/sites-available/refinery << 'EOF'
# API
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 200M;
    }
}

# MinIO Console (admin UI — restrict access!)
server {
    listen 80;
    server_name minio.your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:9001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
    }
}

# Frontend (self-hosted)
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/refinery;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/refinery /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### SSL Certificates:

```bash
sudo certbot --nginx -d api.your-domain.com -d minio.your-domain.com -d your-domain.com
```

## 10. Build & Deploy Frontend

```bash
cd /root/refinery/axiom-data-hub
npm install
npm run build

# Copy built output to web root (served by Nginx)
sudo cp -r dist/* /home/anweshrath/htdocs/iiiemail.email/
```

## 11. Supabase Config

In your Supabase dashboard:
- **Auth → Site URL:** `https://your-domain.com`
- **Auth → Redirect URLs:** `https://your-domain.com/**`
- Run pending migration in SQL Editor:
  ```sql
  -- Migration 009: Add minio server type
  ALTER TABLE servers DROP CONSTRAINT IF EXISTS servers_type_check;
  ALTER TABLE servers ADD CONSTRAINT servers_type_check
    CHECK (type IN ('clickhouse', 's3', 'linode', 'minio'));
  UPDATE servers SET type = 'minio' WHERE type = 'linode';
  ```

## 12. Verify Everything

```bash
# ClickHouse
sudo systemctl status clickhouse-server
clickhouse-client --password YOUR_PASSWORD -q "SHOW DATABASES"

# MinIO
sudo systemctl status minio
mc ls local/refinery-data

# Backend
pm2 status
curl -s http://localhost:4000/api/health

# Nginx
sudo systemctl status nginx
```

## 13. Monitoring & Logs

```bash
pm2 logs refinery-api          # Backend logs
sudo journalctl -u minio -f    # MinIO logs
sudo journalctl -u clickhouse-server -f
sudo tail -f /var/log/nginx/error.log
```

## 14. Backup

```bash
cat > /home/deploy/backup.sh << 'SCRIPT'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/mnt/minio-data/backups"
mkdir -p $BACKUP_DIR

# ClickHouse backup
clickhouse-client --password YOUR_PASSWORD -q \
  "BACKUP DATABASE refinery TO Disk('default', 'backup_${DATE}')"

# MinIO data is already on the SATA disk — just sync to a second location if needed
echo "[Backup] Done: $DATE"
SCRIPT

chmod +x /home/deploy/backup.sh
# Cron: daily at 3 AM
(crontab -l 2>/dev/null; echo "0 3 * * * /home/deploy/backup.sh") | crontab -
```

---

## Architecture

```
                 ┌─────────────────────────────────────────────┐
                 │         RackNerd Dedicated Server           │
                 │  Ubuntu 24.04 · 32GB RAM                    │
                 │                                              │
                 │  ┌──────────┐    ┌──────────────────────┐   │
Internet ───────►│  │  Nginx   │───►│  Node.js API (PM2)   │   │
HTTPS            │  │ :80/:443 │    │  :4000               │   │
                 │  └──────────┘    └──────┬───────────────┘   │
                 │       │                 │                    │
                 │       │         ┌───────┴────────┐          │
                 │       │         │  ClickHouse    │          │
                 │       │         │  :8123 (local) │          │
                 │       │         │  (500GB SSD)   │          │
                 │       │         └────────────────┘          │
                 │       │                 │                    │
                 │       │         ┌───────┴────────┐          │
                 │       │         │     MinIO      │          │
                 │       │         │  :9000 (local) │          │
                 │       │         │  (500GB SATA)  │          │
                 │       │         └────────────────┘          │
                 │       │                                      │
                 │  ┌────┴────────┐                            │
                 │  │  Frontend   │                            │
                 │  │  (static)   │                            │
                 │  └─────────────┘                            │
                 └─────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
                 ┌────────────────────────┐
                 │     Supabase Cloud     │
                 │  Auth · Postgres       │
                 │  Profiles · Teams      │
                 │  Roles · Servers       │
                 └────────────────────────┘
```

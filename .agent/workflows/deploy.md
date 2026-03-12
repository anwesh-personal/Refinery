---
description: How to deploy Refinery Nexus on a dedicated Ubuntu server
---

# Deploying Refinery Nexus — Full Stack on Ubuntu 24.04

**Server spec:** 16GB RAM, 300-400GB SSD, Ubuntu 24.04
**Stack on this server:** ClickHouse + Node.js Backend + Nginx Reverse Proxy

> Supabase stays as a managed cloud service (auth, profiles, teams, servers tables).
> The frontend can be deployed to Vercel/Netlify or self-hosted behind Nginx.

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
# DO NOT expose ClickHouse ports (8123, 9000) to the internet
sudo ufw enable
```

## 3. Install ClickHouse

```bash
# Official ClickHouse install (always latest stable)
sudo apt-get install -y apt-transport-https ca-certificates
curl -fsSL https://packages.clickhouse.com/rpm/lts/repodata/repomd.xml.key | sudo gpg --dearmor -o /usr/share/keyrings/clickhouse-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/clickhouse-keyring.gpg] https://packages.clickhouse.com/deb stable main" | sudo tee /etc/apt/sources.list.d/clickhouse.list
sudo apt-get update
sudo apt-get install -y clickhouse-server clickhouse-client

# It will prompt for a default password — SET ONE (you'll use it in env vars)
# Start ClickHouse
sudo systemctl enable clickhouse-server
sudo systemctl start clickhouse-server

# Verify
clickhouse-client --password YOUR_PASSWORD -q "SELECT version()"
```

### ClickHouse Config Tuning (16GB server)

Edit `/etc/clickhouse-server/config.xml`:
```xml
<!-- Memory limit: leave ~4GB for OS + Node.js -->
<max_memory_usage>10000000000</max_memory_usage>  <!-- 10GB -->

<!-- Listen only on localhost (backend connects locally) -->
<listen_host>127.0.0.1</listen_host>

<!-- HTTP interface on 8123 (default) — local only -->
<http_port>8123</http_port>
```

Edit `/etc/clickhouse-server/users.xml`:
```xml
<profiles>
    <default>
        <max_memory_usage>10000000000</max_memory_usage>
        <max_execution_time>300</max_execution_time>
    </default>
</profiles>
```

```bash
sudo systemctl restart clickhouse-server
```

## 4. Install Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node --version   # v20.x
npm --version
```

## 5. Install PM2 (Process Manager)

```bash
sudo npm install -g pm2

# Auto-start PM2 on boot
pm2 startup systemd
# Run the command it outputs
```

## 6. Clone & Configure Backend

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
CLICKHOUSE_USERNAME=default
CLICKHOUSE_PASSWORD=YOUR_CLICKHOUSE_PASSWORD

# Supabase (cloud)
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...
SUPABASE_ANON_KEY=eyJ...your-anon-key...

# Frontend URL (for CORS)
FRONTEND_URL=https://your-domain.com

# S3/Linode Object Storage (for CSV ingestion)
S3_ENDPOINT=https://your-region.linodeobjects.com
S3_BUCKET=your-bucket
S3_REGION=us-east-1
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key

# Verify550 (optional — can also configure via UI)
# VERIFY550_ENDPOINT=https://api.verify550.com/v1
# VERIFY550_API_KEY=v550-key-xxx
EOF
```

### Build & Start:

```bash
npm run build
pm2 start dist/index.js --name refinery-api
pm2 save
```

### Verify backend is running:

```bash
curl http://localhost:4000/api/health
# Should return: {"status":"ok","uptime":...,"env":"production"}
```

On first start, the backend auto-creates all ClickHouse tables (universal_person, segments, verification_batches, etc.)

## 7. Install Nginx + SSL

```bash
sudo apt install -y nginx
sudo apt install -y certbot python3-certbot-nginx
```

### Create Nginx config:

```bash
sudo tee /etc/nginx/sites-available/refinery << 'EOF'
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
        proxy_cache_bypass $http_upgrade;

        # Large file uploads for CSV ingestion
        client_max_body_size 50M;
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/refinery /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

### SSL Certificate:

```bash
sudo certbot --nginx -d api.your-domain.com
# Follow prompts, auto-renew is configured automatically
```

## 8. Frontend Deployment

### Option A: Vercel (Recommended)
```bash
# From your local machine
cd axiom-data-hub
npm install -g vercel
vercel
# Set env var: VITE_API_URL=https://api.your-domain.com
```

### Option B: Self-hosted on same server
```bash
cd /home/deploy/refinery/axiom-data-hub
npm install
# Set the API URL
echo "VITE_API_URL=https://api.your-domain.com" > .env.production
npm run build

# Serve via Nginx
sudo mkdir -p /var/www/refinery
sudo cp -r dist/* /var/www/refinery/
```

Then add a second Nginx server block for the frontend:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/refinery;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;  # SPA routing
    }
}
```

## 9. Supabase Config

In your Supabase dashboard, make sure these are set:
- **Auth → URL Configuration → Site URL:** `https://your-domain.com`
- **Auth → URL Configuration → Redirect URLs:** `https://your-domain.com/**`
- **SQL Editor:** Run `NOTIFY pgrst, 'reload schema';` to refresh PostgREST cache

## 10. Verify Everything

```bash
# ClickHouse running
sudo systemctl status clickhouse-server

# Backend running
pm2 status
curl -s https://api.your-domain.com/api/health | jq .

# Nginx running
sudo systemctl status nginx

# SSL valid
curl -I https://api.your-domain.com
```

## 11. Monitoring & Logs

```bash
# Backend logs
pm2 logs refinery-api

# ClickHouse logs
sudo journalctl -u clickhouse-server -f

# Nginx access/error logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## 12. Backup (ClickHouse)

```bash
# Create a backup script
cat > /home/deploy/backup-clickhouse.sh << 'SCRIPT'
#!/bin/bash
BACKUP_DIR="/home/deploy/backups"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

clickhouse-client --password YOUR_PASSWORD -q \
  "BACKUP DATABASE refinery TO Disk('backups', 'refinery_${DATE}')"

echo "[Backup] Completed: refinery_${DATE}"
SCRIPT

chmod +x /home/deploy/backup-clickhouse.sh

# Cron: daily backup at 3 AM
(crontab -l 2>/dev/null; echo "0 3 * * * /home/deploy/backup-clickhouse.sh") | crontab -
```

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│              Your Dedicated Server              │
│                 Ubuntu 24.04                     │
│                                                  │
│  ┌──────────┐    ┌───────────────┐              │
│  │  Nginx   │───→│ Node.js API   │              │
│  │ :80/:443 │    │ (PM2) :4000   │              │
│  └──────────┘    └───────┬───────┘              │
│       │                  │                       │
│       │           ┌──────┴──────┐               │
│       │           │ ClickHouse  │               │
│       │           │   :8123     │               │
│       │           │  (local)    │               │
│       │           └─────────────┘               │
│       │                                          │
│  ┌────┴────┐                                    │
│  │Frontend │  (or Vercel/Netlify)               │
│  │ static  │                                    │
│  └─────────┘                                    │
└─────────────────────────────────────────────────┘
         │
         │ HTTPS
         ▼
┌─────────────────┐
│  Supabase Cloud │
│  (Auth, Postgres)│
└─────────────────┘
```

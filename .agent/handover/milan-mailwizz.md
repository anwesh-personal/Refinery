# 📥 MailWizz 2.7.6 Installation Guide — For Milan

**Server:** RackNerd Dedicated (Ubuntu 24.04, 32GB RAM, Intel Xeon E3-1240 V3)
**Current state:** CloudPanel is already installed, managing `iiiemail.email` on the primary IP. MailWizz goes on a **second IP** so nothing breaks.

---

## 🔐 Credentials You'll Need

| Item | Value |
|------|-------|
| **Server SSH** | `ssh root@107.172.56.66` |
| **Root Password** | `AuVkRFXqz5GY8qn5` |
| **CloudPanel** | `https://107.172.56.66:8443` |
| **MySQL (Percona 8.4)** | Already running on `127.0.0.1:3306` |
| **Available IPs** | `107.172.56.67` through `107.172.56.78` (pick any) |
| **Gateway** | `107.172.56.65` |
| **Network Interface** | `eno1` |

---

## ⚠️ DO NOT TOUCH

These services are already running on the server. **DO NOT** restart, reconfigure, or uninstall them:

- **Nginx** (managed by CloudPanel)
- **Varnish** (caching proxy for CloudPanel)
- **ClickHouse** (port 8123 — data warehouse)
- **MinIO** (port 9002 — object storage)
- **PM2 / Node.js** (port 4000 — backend API)
- The site `iiiemail.email` and its config files

---

## Step 1: Bind a Second IP Address

1. SSH into the server:
   ```bash
   ssh root@107.172.56.66
   ```

2. Edit the network config:
   ```bash
   nano /etc/netplan/50-cloud-init.yaml
   ```

3. The file currently looks like this:
   ```yaml
   network:
     version: 2
     ethernets:
       eno1:
         addresses:
         - "107.172.56.66/28"
         nameservers:
           addresses:
           - 8.8.8.8
           search: []
         routes:
         - to: "default"
           via: "107.172.56.65"
   ```

4. Add the second IP. Change the `addresses` section to:
   ```yaml
         addresses:
         - "107.172.56.66/28"
         - "107.172.56.67/28"
   ```
   ⚠️ **YAML is whitespace-sensitive.** Use exactly 2 spaces per indent level. Do NOT use tabs.

5. Apply:
   ```bash
   netplan apply
   ```

6. Verify:
   ```bash
   ip addr show eno1
   ```
   You should see both `107.172.56.66/28` and `107.172.56.67/28` listed.

---

## Step 2: DNS — Point Your MailWizz Domain

Go to your domain's DNS manager (Cloudflare, Namecheap, etc.) and create:

| Type | Name | Value | Proxy |
|------|------|-------|-------|
| A | `mail.yourdomain.com` (or whatever) | `107.172.56.67` | **OFF** (DNS only / grey cloud) |

Wait 5–10 minutes for propagation. Test with:
```bash
dig mail.yourdomain.com +short
# Should return: 107.172.56.67
```

---

## Step 3: Install ionCube Loader (REQUIRED)

MailWizz 2.x is encoded with ionCube. Without this, you'll get a blank page or a fatal error.

```bash
# Download ionCube for PHP 8.1
cd /tmp
wget https://downloads.ioncube.com/loader_downloads/ioncube_loaders_lin_x86-64.tar.gz
tar xzf ioncube_loaders_lin_x86-64.tar.gz

# Find the correct .so for PHP 8.1
ls ioncube/ioncube_loader_lin_8.1.*
# You should see: ioncube_loader_lin_8.1.so

# Copy to the PHP extensions directory
cp ioncube/ioncube_loader_lin_8.1.so /etc/php/8.1/lib/php/extensions/

# Enable it — must be the FIRST thing loaded
echo "zend_extension = /etc/php/8.1/lib/php/extensions/ioncube_loader_lin_8.1.so" > /etc/php/8.1/fpm/conf.d/00-ioncube.ini
echo "zend_extension = /etc/php/8.1/lib/php/extensions/ioncube_loader_lin_8.1.so" > /etc/php/8.1/cli/conf.d/00-ioncube.ini

# Restart PHP-FPM
systemctl restart php8.1-fpm

# Verify
php8.1 -m | grep -i ioncube
# Should print: ionCube Loader
```

> **Note:** If the PHP extensions directory is different on your server, find it with:
> ```bash
> php8.1 -i | grep extension_dir
> ```
> And adjust the `cp` and `zend_extension` paths accordingly.

---

## Step 4: Install IMAP Extension (REQUIRED for Bounce Handling)

```bash
apt update
apt install -y php8.1-imap

# Restart PHP-FPM
systemctl restart php8.1-fpm

# Verify
php8.1 -m | grep -i imap
# Should print: imap
```

---

## Step 5: Add the PHP Site in CloudPanel

You can do this via **CloudPanel UI** or **CLI**. CLI is faster:

```bash
clpctl site:add:php \
  --domainName=mail.yourdomain.com \
  --phpVersion=8.1 \
  --vhostTemplate='Generic' \
  --siteUser=mailwizz \
  --siteUserPassword='ChooseAStrongPassword!'
```

This creates:
- A Linux user `mailwizz`
- Document root at `/home/mailwizz/htdocs/mail.yourdomain.com/`
- An Nginx vhost configured for PHP 8.1

**Alternatively via the CloudPanel UI:**
1. Go to `https://107.172.56.66:8443`
2. **Sites** → **Add Site** → **Create a PHP Site**
3. Domain: `mail.yourdomain.com`
4. PHP Version: `8.1`
5. Site User: `mailwizz`
6. Set a password → **Create**

---

## Step 6: Install SSL Certificate

Once DNS is propagated (Step 2):

```bash
clpctl lets-encrypt:install:certificate --domainName=mail.yourdomain.com
```

Or via CloudPanel UI: **Sites** → click the site → **SSL/TLS** → **New Let's Encrypt Certificate** → **Create and Install**.

---

## Step 7: Create the MySQL Database

```bash
clpctl db:add \
  --domainName=mail.yourdomain.com \
  --databaseName=mailwizz_db \
  --databaseUserName=mailwizz_user \
  --databaseUserPassword='AnotherStrongPassword!'
```

**Save these credentials — you'll need them during MailWizz's web installer.**

| Item | Value |
|------|-------|
| DB Host | `127.0.0.1` |
| DB Port | `3306` |
| DB Name | `mailwizz_db` |
| DB User | `mailwizz_user` |
| DB Pass | `AnotherStrongPassword!` (whatever you set) |

---

## Step 8: Upload MailWizz Files

1. **SFTP** into the server. Connect to **`107.172.56.66`** (the main IP, port `22`):
   - **Host:** `107.172.56.66`
   - **Port:** `22`
   - **Username:** `mailwizz` (the site user from Step 5)
   - **Password:** (the password you set in Step 5)

2. Navigate to `htdocs/mail.yourdomain.com/`

3. From the `mailwizz-2.7.6` package, open the `latest/` folder. Upload **the contents** of `latest/` directly into `htdocs/mail.yourdomain.com/`. The structure should look like:
   ```
   htdocs/mail.yourdomain.com/
   ├── apps/
   ├── install/
   ├── index.php
   ├── ...
   ```

4. Set permissions (via SSH as root):
   ```bash
   chown -R mailwizz:mailwizz /home/mailwizz/htdocs/mail.yourdomain.com/
   find /home/mailwizz/htdocs/mail.yourdomain.com/ -type d -exec chmod 755 {} \;
   find /home/mailwizz/htdocs/mail.yourdomain.com/ -type f -exec chmod 644 {} \;
   ```

5. MailWizz requires some directories to be writable:
   ```bash
   chmod -R 775 /home/mailwizz/htdocs/mail.yourdomain.com/apps/common/runtime/
   chmod -R 775 /home/mailwizz/htdocs/mail.yourdomain.com/frontend/assets/cache/
   chmod -R 775 /home/mailwizz/htdocs/mail.yourdomain.com/frontend/assets/files/
   chmod -R 775 /home/mailwizz/htdocs/mail.yourdomain.com/backend/assets/cache/
   ```

---

## Step 9: Run the Web Installer

1. Open your browser and go to:
   ```
   https://mail.yourdomain.com/install/
   ```

2. The installer will check requirements. If anything is red:
   - Missing ionCube → Go back to Step 3
   - Missing IMAP → Go back to Step 4
   - Missing any other extension → `apt install php8.1-<extension>` then `systemctl restart php8.1-fpm`

3. When prompted for database credentials, enter the values from **Step 7**.

4. Complete the wizard (admin email, password, etc.).

5. **After install completes**, delete the install directory:
   ```bash
   rm -rf /home/mailwizz/htdocs/mail.yourdomain.com/install/
   ```

---

## Step 10: Set Up Cron Jobs

The installer will display cron commands at the end. Add them for the `mailwizz` user:

```bash
crontab -u mailwizz -e
```

Paste in whatever the installer tells you. Typically something like:
```cron
* * * * * /usr/bin/php8.1 -q /home/mailwizz/htdocs/mail.yourdomain.com/apps/console/console.php cron
```

---

## Step 11: Access MailWizz

| Panel | URL |
|-------|-----|
| **Backend (Admin)** | `https://mail.yourdomain.com/backend/` |
| **Customer Area** | `https://mail.yourdomain.com/customer/` |
| **Frontend** | `https://mail.yourdomain.com/` |

---

## 🧠 Architecture After Install

```
┌─── Server: 107.172.56.66 (racknerd-e42467e) ─────────────────────┐
│                                                                    │
│  IP: 107.172.56.66                  IP: 107.172.56.67              │
│  ├── iiiemail.email                 ├── mail.yourdomain.com        │
│  ├── React Frontend (static)        ├── MailWizz 2.7.6 (PHP)      │
│  ├── Node.js API (:4000)            ├── Nginx → PHP 8.1-FPM       │
│  ├── ClickHouse (:8123)             └── MySQL/Percona (:3306)      │
│  ├── MinIO (:9002)                       (shared, same instance)   │
│  └── CloudPanel (:8443)                                            │
│                                                                    │
│  Both IPs share: 32GB RAM, 465GB SSD, 1.8TB SATA                  │
└────────────────────────────────────────────────────────────────────┘
```

---

## ❗ Troubleshooting

| Problem | Fix |
|---------|-----|
| Blank page after visiting /install | ionCube not installed (Step 3) |
| "PDO MySQL not found" | `apt install php8.1-mysql && systemctl restart php8.1-fpm` |
| SSL cert fails | DNS not propagated yet. Wait & retry. Make sure Cloudflare proxy is OFF |
| 502 Bad Gateway | PHP-FPM not running: `systemctl restart php8.1-fpm` |
| Permission denied | Re-run `chown -R mailwizz:mailwizz /home/mailwizz/htdocs/...` |
| Can't connect to DB | Use `127.0.0.1` not `localhost` (avoids socket issues with Percona) |

---

*Prepared by Anwesh · March 2026*

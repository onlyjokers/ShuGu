# ShuGu Deployment Guide

This guide will help you deploy the ShuGu Interactive Art System to a Linux server (e.g., Ubuntu).

## 1. Prerequisites (On Server)

Connect to your server via SSH and install the necessary tools.

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js (v18+)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install pnpm and pm2
sudo npm install -g pnpm pm2

# Install Nginx
sudo apt install -y nginx

# Install Certbot (for free SSL)
sudo apt install -y certbot python3-certbot-nginx
```

## 2. Get the Code (On Server)

Navigate to your web directory (e.g., `/var/www`) and ensure you have the latest code.

```bash
cd /var/www/ShuGu
git pull origin main
```

> **Note:** Make sure you have pushed the local changes (adapter-node setup, ecosystem.config.cjs) to your repository before pulling!

## 3. Install & Build (On Server)

Install dependencies and build the server and client applications.

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build:all
```

## 3.1 Asset Service (Storage & Env)

ShuGu ships an Asset Service (audio/image/video) which stores uploaded binaries on disk and serves them over HTTP(S).

**Defaults (no env):**
- Data directory: `data/assets/` (relative to repo root)
- Index DB: `data/assets/assets-index.json`

**Recommended: create `secrets/server.env` (not committed)**

The server loads env automatically from `secrets/server.env` (or `apps/server/secrets/server.env`) at startup.

Example:
```bash
# Required (write protection)
ASSET_WRITE_TOKEN=your-strong-token

# Optional (public-read by default; set this to restrict reads)
# ASSET_READ_TOKEN=optional-read-token

# Optional (override storage locations)
# ASSET_DATA_DIR=/var/lib/shugu/assets
# ASSET_DB_PATH=/var/lib/shugu/assets/assets-index.json

# Optional (what the server returns as contentUrl base)
# ASSET_PUBLIC_BASE_URL=https://yourdomain.com
```

**Backup strategy (important)**
- Back up the full asset data dir (default `data/assets/`) including `assets-index.json`.
- Content files are stored by sha256 under subfolders; restoring the directory restores all assets.

## 4. Start Applications with PM2

We use PM2 to keep the applications running in the background.

```bash
# Start the apps using the ecosystem config
pm2 start ecosystem.config.cjs

# Save the PM2 list so it restarts on reboot
pm2 save
pm2 startup
```


## 5. Configure Nginx

Nginx will serve as the reverse proxy, handling HTTPS and routing traffic.
- Root `/`: Client App
- `/manager`: Manager App
- `/socket.io`: Server

1.  Copy the example config or create a new one:
    ```bash
    sudo cp nginx.conf.example /etc/nginx/sites-available/shugu
    ```

2.  Edit the file to set your domain name:
    ```bash
    sudo nano /etc/nginx/sites-available/shugu
    ```
    *Replace `example.com` with your actual domain name.*

3.  Enable the site:
    ```bash
    sudo ln -s /etc/nginx/sites-available/shugu /etc/nginx/sites-enabled/
    sudo nginx -t  # Test configuration
    sudo systemctl restart nginx
    ```

## 6. Setup SSL (HTTPS) & Fix Redirect Loops

Security is required for accessing mobile sensors (gyroscope, camera, etc.).

```bash
sudo certbot --nginx -d yourdomain.com
```

### 🔴 Important: Fixing "Too Many Redirects"

If you see "Redirected you too many times" error:

1.  **Check Cloudflare (if using):**
    -   Log in to Cloudflare Dashboard.
    -   Go to **SSL/TLS**.
    -   Change the encryption mode to **Full** or **Full (Strict)**.
    -   *Do NOT use "Flexible"*, as it causes infinite redirect loops with Nginx HTTPS redirects.

2.  **Check Nginx Config manually:**
    -   Edit `/etc/nginx/sites-available/shugu`.
    -   If Cloudflare is already redirecting HTTP to HTTPS, you might need to comment out the `return 301 ...` line in the server block listening on port 80.

### 🔴 Problem: Seeing Old Project / Default Nginx Page?

If you see an old project or the "Welcome to nginx" page instead of ShuGu:

1.  **Disable the Default Config**:
    The default config usually has `default_server` priority, overriding your new config if not matched perfectly.
    ```bash
    sudo rm /etc/nginx/sites-enabled/default
    ```

2.  **Enable ShuGu Config**:
    Ensure your config is actually linked.
    ```bash
    sudo ln -s /etc/nginx/sites-available/shugu /etc/nginx/sites-enabled/
    ```

3.  **Restart Nginx**:
    ```bash
    sudo nginx -t
    sudo systemctl restart nginx
    ```

## 7. Troubleshooting

-   **Check Logs:**
    -   PM2 logs: `pm2 logs`
    -   Nginx logs: `sudo tail -f /var/log/nginx/error.log`
-   **Ports:**
    -   Ensure your server's firewall allows ports 80 and 443.
    -   The internal apps run on localhost:3000 (Client) and localhost:3001 (Server). These do NOT need to be exposed publicly if Nginx is configured correctly.

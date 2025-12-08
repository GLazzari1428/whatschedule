# Production Deployment Guide

This guide will help you deploy WhatScheduler in production using Docker Compose.

## Prerequisites

- Docker and Docker Compose installed
- At least 2GB RAM available
- Port 3000 available (or configure a different port)
- Active WhatsApp account

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/GLazzari1428/whatschedule.git
cd whatschedule
```

### 2. Configure Environment

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and set your preferences:

```env
PORT=3000
NODE_ENV=production
TZ=America/Sao_Paulo
```

### 3. Start the Application

```bash
docker-compose up -d
```

### 4. Access the Application

Open your browser and navigate to:
- `http://YOUR_SERVER_IP:3000` (if using network_mode: host)
- `http://localhost:3000` (if using bridge network)

### 5. Connect WhatsApp

1. Open the web interface
2. Scan the QR code with WhatsApp:
   - Open WhatsApp on your phone
   - Settings → Linked Devices → Link a Device
   - Scan the QR code

## Production Configuration

### Option A: Using Host Network (Current Setup)

**Pros:**
- Simple setup
- Direct access to host network
- No port mapping needed

**Cons:**
- Less isolation
- Can't run multiple instances on same host

**docker-compose.yml:**
```yaml
network_mode: host
```

### Option B: Using Bridge Network (Recommended for Production)

**Pros:**
- Better isolation
- Can run multiple instances
- More secure

**Cons:**
- Requires port mapping
- Slightly more complex

To use bridge network, update `docker-compose.yml`:

```yaml
services:
  whatsapp-scheduler:
    # Remove: network_mode: host
    ports:
      - "3000:3000"  # Add this instead
```

### Option C: Using Reverse Proxy (Best for Production)

Use Nginx or Traefik as reverse proxy:

**docker-compose.yml:**
```yaml
services:
  whatsapp-scheduler:
    ports:
      - "127.0.0.1:3000:3000"  # Only accessible from localhost
    
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - whatsapp-scheduler
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `NODE_ENV` | `production` | Node.js environment |
| `TZ` | `America/Sao_Paulo` | Timezone for cron jobs |
| `DATA_DIR` | `./data` | Data directory path |
| `PUPPETEER_EXECUTABLE_PATH` | Auto-detected | Chromium executable path |

## Docker Commands

### Start Services
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose down
```

### View Logs
```bash
docker-compose logs -f
```

### Restart Services
```bash
docker-compose restart
```

### Update Application
```bash
git pull
docker-compose build
docker-compose up -d
```

### Check Status
```bash
docker-compose ps
```

## Data Persistence

Data is stored in Docker volumes:

- `whatsapp-data`: Database and scheduled messages
- `whatsapp-auth`: WhatsApp authentication (QR code session)

**Important:** These volumes persist data even when containers are removed.

### Backup Data

```bash
# Backup database
docker run --rm \
  -v whatscheduler_whatsapp-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/whatsapp-backup-$(date +%Y%m%d).tar.gz -C /data .

# Backup authentication
docker run --rm \
  -v whatscheduler_whatsapp-auth:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/whatsapp-auth-backup-$(date +%Y%m%d).tar.gz -C /data .
```

### Restore Data

```bash
# Restore database
docker run --rm \
  -v whatscheduler_whatsapp-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/whatsapp-backup-YYYYMMDD.tar.gz"

# Restore authentication
docker run --rm \
  -v whatscheduler_whatsapp-auth:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/whatsapp-auth-backup-YYYYMMDD.tar.gz"
```

## Security Considerations

### 1. Firewall Configuration

Only expose port 3000 to trusted networks:

```bash
# UFW example
sudo ufw allow from 192.168.1.0/24 to any port 3000
```

### 2. Reverse Proxy with HTTPS

For production, use HTTPS with a reverse proxy:

**Nginx Configuration Example:**
```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://whatsapp-scheduler:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Resource Limits

Add resource limits to `docker-compose.yml`:

```yaml
services:
  whatsapp-scheduler:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### 4. Health Checks

Health checks are already configured. Monitor with:

```bash
docker-compose ps
```

## Monitoring

### View Logs
```bash
docker-compose logs -f whatsapp-scheduler
```

### Check Health
```bash
curl http://localhost:3000/api/status
```

### Resource Usage
```bash
docker stats whatsapp-scheduler
```

## Troubleshooting

### Container Won't Start

1. Check logs: `docker-compose logs whatsapp-scheduler`
2. Verify port is available: `netstat -tuln | grep 3000`
3. Check disk space: `df -h`

### WhatsApp Connection Issues

1. Check if QR code appears in logs
2. Verify network connectivity
3. Restart container: `docker-compose restart`

### High Memory Usage

1. Check logs for memory leaks
2. Restart container periodically
3. Add resource limits (see above)

### Data Loss

1. Check volume mounts: `docker volume ls`
2. Verify volumes exist: `docker volume inspect whatscheduler_whatsapp-data`
3. Restore from backup (see Backup section)

## Updating

### Automatic Updates (Watchtower)

Watchtower is configured to auto-update the container:

- Checks every 5 minutes (300 seconds)
- Automatically restarts with new image
- Cleans up old images

To disable auto-updates, remove the watchtower service from `docker-compose.yml`.

### Manual Updates

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose build
docker-compose up -d
```

## Performance Optimization

### 1. Increase Node.js Memory (if needed)

Add to `docker-compose.yml`:

```yaml
environment:
  - NODE_OPTIONS=--max-old-space-size=2048
```

### 2. Use SSD Storage

Ensure Docker volumes are on SSD for better performance.

### 3. Monitor Resource Usage

```bash
docker stats whatsapp-scheduler --no-stream
```

## Production Checklist

- [ ] Environment variables configured
- [ ] Firewall rules set
- [ ] Reverse proxy configured (if using HTTPS)
- [ ] Resource limits set
- [ ] Backup strategy in place
- [ ] Monitoring configured
- [ ] Health checks working
- [ ] Logs accessible
- [ ] WhatsApp connected and tested
- [ ] Mobile app configured with server URL

## Support

For issues or questions:
- GitHub Issues: https://github.com/GLazzari1428/whatschedule/issues
- Check logs: `docker-compose logs -f`


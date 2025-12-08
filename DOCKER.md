# Docker Production Setup

Quick guide to run WhatScheduler in production using Docker Compose.

## Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/GLazzari1428/whatschedule.git
cd whatschedule
```

### 2. Configure (Optional)

Create `.env` file if you want to customize:

```bash
cat > .env << EOF
PORT=3000
NODE_ENV=production
TZ=America/Sao_Paulo
EOF
```

### 3. Start the Application

```bash
docker-compose up -d
```

### 4. Access the Application

Open your browser:
- `http://YOUR_SERVER_IP:3000`
- Or `http://localhost:3000` if on the same machine

### 5. Connect WhatsApp

1. Scan QR code with WhatsApp
2. Settings → Linked Devices → Link a Device

## Common Commands

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# View logs
docker-compose logs -f

# Restart
docker-compose restart

# Rebuild and restart
docker-compose build
docker-compose up -d
```

## Network Configuration

### Current Setup: Host Network

The default `docker-compose.yml` uses `network_mode: host`, which means:
- Container uses host's network directly
- Accessible at `http://YOUR_SERVER_IP:3000`
- No port mapping needed

### Alternative: Bridge Network

If you prefer bridge network, edit `docker-compose.yml`:

```yaml
services:
  whatsapp-scheduler:
    # Remove this line:
    # network_mode: host
    
    # Add this instead:
    ports:
      - "3000:3000"
```

## Data Persistence

Data is automatically saved in Docker volumes:
- `whatsapp-data`: Database and scheduled messages
- `whatsapp-auth`: WhatsApp session (so you don't need to re-scan QR)

**Data persists even if you remove containers!**

## Updating

### Automatic (with Watchtower)

Watchtower automatically updates the container every 5 minutes if using the pre-built image.

### Manual Update

```bash
git pull
docker-compose build
docker-compose up -d
```

## Troubleshooting

### Check if running
```bash
docker-compose ps
```

### View logs
```bash
docker-compose logs -f whatsapp-scheduler
```

### Restart if issues
```bash
docker-compose restart whatsapp-scheduler
```

### Check health
```bash
curl http://localhost:3000/api/status
```

## Production Tips

1. **Firewall**: Only expose port 3000 to trusted networks
2. **HTTPS**: Use reverse proxy (Nginx/Traefik) for HTTPS
3. **Backups**: Regularly backup the Docker volumes
4. **Monitoring**: Monitor logs and resource usage

See `PRODUCTION.md` for detailed production deployment guide.


# WhatsApp Message Scheduler

A self-hosted WhatsApp message scheduler with realistic typing delays. Perfect for managing social anxiety around texting by scheduling messages in advance.

## Features

This application provides scheduling of messages with precise timing using 24-hour format. Messages can be sent with realistic typing delays between multiple messages, typically 3-8 seconds apart. The system supports both individual contacts and group chats.

The interface includes a favorites system for quick access to frequently contacted people or groups. A real-time search function with YouTube-style dropdown makes finding contacts fast and intuitive. WebSocket technology provides instant synchronization across all connected devices.

The user interface features a dark mode design that is fully mobile responsive, ensuring comfortable use on any device. The entire application is packaged for Docker deployment, making it easy to self-host on any server or personal machine.

## Quick Start with Docker

### Prerequisites

You will need Docker and Docker Compose installed on your system, along with an active WhatsApp account.

### Installation

1. Clone the repository using the command then navigate into the directory:
   ```zsh
   git clone https://github.com/yourusername/whatsapp-scheduler.git
   cd whatsapp-scheduler
```

2. Create your environment file by copying the example:
```zsh
   cp .env.example .env
```
3. Start the application with Docker Compose:
```zsh
   docker-compose up -d
```

4. Access the application by opening your web browser to http://localhost:3000
   You will need to scan the QR code with WhatsApp by going to Settings, then Linked Devices, then Link a Device.

5. To view the application logs, use:
```zsh
   docker-compose logs -f
```

## Manual Installation without Docker

### Prerequisites

You will need Node.js version 16 or higher, along with npm or yarn package manager.

### Setup

1. Install all dependencies by running:
```zsh
   npm install
```

2. Start the server with:
```zsh
   npm start
```
3. Access the application at http://127.0.0.1:3000 and scan the QR code with WhatsApp.

## Usage Guide

### Scheduling Messages

To schedule a message, first search and select a contact or group from the dropdown menu. You can optionally add frequently used contacts to your favorites by clicking the star icon next to their name.

Type your message or messages in the provided text areas. If you add multiple messages, they will be sent with realistic typing delays that simulate natural conversation flow.

Set the date and time using the 24-hour format picker. For example, 14:30 represents 2:30 PM. When you are ready, click the Schedule button to queue your messages.

### Multiple Messages with Realistic Delays

When you schedule multiple messages together, the system automatically calculates realistic delays between them based on message length and natural typing speed. For example, if you schedule three messages for 14:00:00, the first message "Hey" might send at exactly 14:00:00, the second message "How are you?" would send approximately at 14:00:05, and the third message "Want to hang out?" would send around 14:00:11.

### Managing Scheduled Messages

You can edit the scheduled time of any message before it is sent. Individual messages can be deleted if you change your mind. For conversations with multiple scheduled messages, you can delete the entire batch at once.

## Docker Commands Reference

To build the Docker image, use:
```zsh
docker-compose build
```

To start the services in detached mode:
```zsh
docker-compose up -d
```

To stop all services:
```zsh
docker-compose down
```

To view real-time logs:
```zsh
docker-compose logs -f
```

To restart the application:
```zsh
docker-compose restart
```

To update to the latest version, first pull the latest code with git pull, then rebuild and restart:
```zsh
docker-compose build
docker-compose up -d
```
## Data Persistence

All data is persisted in Docker volumes to ensure nothing is lost when the container restarts. The whatsapp-data volume stores the database containing scheduled messages and favorites. The whatsapp-auth volume stores WhatsApp authentication data, which means you will not need to re-scan the QR code after restarting.

### Backup and Restore

To backup your data volumes, run:
```zsh
docker run --rm -v whatsapp-scheduler_whatsapp-data:/data -v $(pwd):/backup alpine tar czf /backup/whatsapp-backup.tar.gz /data
```
To restore from a backup:
```zsh
docker run --rm -v whatsapp-scheduler_whatsapp-data:/data -v $(pwd):/backup alpine tar xzf /backup/whatsapp-backup.tar.gz -C /
```
## Configuration

Edit the .env file to customize your installation:

```.env
PORT=3000
This sets the port number where the application will be accessible. Default is 3000.

TZ=America/Sao_Paulo
This sets the timezone for cron jobs and logging. Adjust to your local timezone.

NODE_ENV=production
This sets the Node.js environment mode. Use production for deployed instances.
```

## Security Notes

This application uses WhatsApp Web, which is within WhatsApp's terms of service for personal use. It is designed for low-volume personal use only and should not be used for spam or bulk messaging operations.

All data is stored locally on your server with no external services involved. Since the application is self-hosted, you maintain complete control over your data and privacy.

## Important Note

This project is intended for personal use only. Please use it responsibly and respect WhatsApp's terms of service. It is not designed for commercial bulk messaging or spam operations.

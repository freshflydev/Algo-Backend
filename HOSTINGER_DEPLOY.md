# Hostinger Production Deployment

Recommended setup: Hostinger VPS with Ubuntu, Node.js 22+ or 24+, PM2 for the backend, Nginx as reverse proxy, and the Vite build served as static files.

## Server Paths

Use separate folders:

```bash
/var/www/algobot/backend
/var/www/algobot/frontend
```

## Backend

```bash
cd /var/www/algobot/backend
npm ci --omit=dev
cp .env.example .env
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Backend should listen only on `127.0.0.1:8080`. Nginx should expose it publicly.

## Frontend

```bash
cd /var/www/algobot/frontend
cp .env.production.example .env.production
npm ci
npm run build
```

Serve `frontend/dist` with Nginx.

## Nginx Sketch

```nginx
server {
  server_name your-domain.com;
  root /var/www/algobot/frontend/dist;
  index index.html;

  location / {
    try_files $uri /index.html;
  }
}

server {
  server_name api.your-domain.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

## Broker Callback URLs

Use public HTTPS callback URLs in broker app settings:

```text
https://api.your-domain.com/api/callback/fyers
https://api.your-domain.com/api/callback/upstox
```

## Before Live Trading

- Renew the data-source broker token.
- Confirm server timezone is IST or schedule code is explicitly using `Asia/Kolkata`.
- Back up `backend/algotrade.sqlite` daily.
- Keep `backend/credentials.json` and SQLite files out of public web roots.
- Start with `dry_run_orders=true`, then switch off only after broker callbacks and live feed are verified.

# Docker Deploy (DigitalOcean Droplet)

This setup runs:
- `backend` (Fastify) on internal `:3000`
- `web` (Next.js) on internal `:3001`
- `caddy` as public HTTPS entrypoint on `:80/:443` (automatic TLS)

## 1) Prerequisites on droplet

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git
sudo usermod -aG docker $USER
```

Log out and back in once after adding your user to the docker group.

## 2) Clone and configure

```bash
git clone https://github.com/HealthInnovators/SteadyAI.git
cd SteadyAI
cp .env .env.production
```

Edit `.env.production` with production values. Required keys:
- `DATABASE_URL`
- `DIRECT_URL`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_DOMAIN` (for example `app.example.com`)
- `API_DOMAIN` (for example `api.example.com`)
- `ACME_EMAIL` (email for Let's Encrypt registration)
- `PUBLIC_BASE_URL` (for example `https://api.example.com`)
- `NEXT_PUBLIC_API_BASE_URL` (for example `https://api.example.com`)
- `APPS_MCP_API_KEY` (if using apps MCP auth)
- LLM keys you use (`OPENAI_API_KEY` or others)

## 3) Build and run

```bash
docker compose --env-file .env.production up -d --build
```

## 4) Sync schema once (recommended with current migration state)

```bash
docker compose --env-file .env.production exec backend npx prisma db push
```

## 5) Optional: seed store catalog

```bash
docker compose --env-file .env.production exec backend npm run seed:store
```

## 6) Validate

```bash
curl -i https://<API_DOMAIN>/api/health
```

Open:
- `https://<APP_DOMAIN>/` (web)
- `https://<APP_DOMAIN>/reports`
- `https://<APP_DOMAIN>/store`

## 7) DNS requirements

Create DNS `A` records pointing to your droplet IP:
- `<APP_DOMAIN>` -> droplet public IP
- `<API_DOMAIN>` -> droplet public IP

Caddy will provision and renew certificates automatically.

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
cp .env.production.example .env.production
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
- `BACKEND_IMAGE` (for example `ghcr.io/openhealthagents/steadyai-backend:main`)
- `WEB_IMAGE` (for example `ghcr.io/openhealthagents/steadyai-web:main`)
- `APPS_MCP_API_KEY` (if using apps MCP auth)
- LLM keys you use (`OPENAI_API_KEY` or others)

Also set the web auth values:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

If your GHCR packages are private, also set:
- `GHCR_USERNAME`
- `GHCR_TOKEN`

## 3) Build images in GitHub Actions

This repo includes a workflow that builds and pushes:
- `ghcr.io/openhealthagents/steadyai-backend:main`
- `ghcr.io/openhealthagents/steadyai-web:main`

Before using it, add these GitHub repository variables:
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Push to `main` or run the `Docker Images` workflow manually once to publish the images.

## 4) Pull and run on the droplet

One-command option:

```bash
chmod +x deploy/digitalocean-deploy.sh
./deploy/digitalocean-deploy.sh --env-file .env.production
```

Manual option:

```bash
docker login ghcr.io
docker compose --env-file .env.production pull backend web caddy
docker compose --env-file .env.production up -d --no-build
```

## 5) Sync schema once (recommended with current migration state)

```bash
docker compose --env-file .env.production exec backend npx prisma db push
```

## 6) Optional: seed store catalog

```bash
docker compose --env-file .env.production exec backend npm run seed:store
```

## 7) Validate

```bash
curl -i https://<API_DOMAIN>/api/health
```

Open:
- `https://<APP_DOMAIN>/` (web)
- `https://<APP_DOMAIN>/reports`
- `https://<APP_DOMAIN>/store`
- `https://<API_DOMAIN>/.well-known/oauth-authorization-server`

## 8) Supabase auth callbacks

In Supabase Auth, add these redirect URLs before testing sign-in:

- `https://<APP_DOMAIN>/auth/callback`
- `https://<API_DOMAIN>/oauth/callback`

If you use localhost for testing too, also keep:

- `http://localhost:3001/auth/callback`

Enable the auth providers you plan to use:

- Google
- Apple

For ChatGPT MCP OAuth, the production connector URL should be:

- `https://<API_DOMAIN>/mcp`

## 9) DNS requirements

Create DNS `A` records pointing to your droplet IP:
- `<APP_DOMAIN>` -> droplet public IP
- `<API_DOMAIN>` -> droplet public IP

Caddy will provision and renew certificates automatically.

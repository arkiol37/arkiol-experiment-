#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║   Animation Studio — Setup Script     ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js 20+ required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ Docker required"; exit 1; }
command -v psql >/dev/null 2>&1 && echo "✅ PostgreSQL client found" || echo "⚠  psql not found (optional)"

NODE_MAJOR=$(node -e "console.log(process.version.split('.')[0].slice(1))")
if [ "$NODE_MAJOR" -lt 20 ]; then echo "❌ Node.js 20+ required (found $(node -v))"; exit 1; fi

# Create .env if missing
if [ ! -f backend/.env ]; then
  cp backend/.env.example backend/.env
  echo "✅ Created backend/.env from .env.example"

  # Auto-generate secrets
  JWT_SECRET=$(openssl rand -base64 64 | tr -d '\n')
  JWT_REFRESH=$(openssl rand -base64 64 | tr -d '\n')
  ENC_KEY=$(openssl rand -hex 32)

  sed -i "s|change_me_at_least_32_characters_long_please_use_openssl$|${JWT_SECRET}|" backend/.env
  sed -i "s|change_me_at_least_32_characters_long_please_use_openssl_2|${JWT_REFRESH}|" backend/.env
  sed -i "s|0000000000000000000000000000000000000000000000000000000000000000|${ENC_KEY}|" backend/.env
  echo "✅ Generated JWT and encryption secrets"
else
  echo "✅ backend/.env already exists"
fi

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
cd backend && npm install && cd ..

# Install frontend dependencies
echo ""
echo "📦 Installing frontend dependencies..."
cd frontend && npm install && cd ..

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit backend/.env with your AWS, Stripe, and AI provider keys"
echo "  2. Start infrastructure: docker compose up postgres redis -d"
echo "  3. Run migrations:       cd backend && npm run migrate"
echo "  4. Start API:            cd backend && npm run dev"
echo "  5. Start worker:         cd backend && npm run worker"
echo "  6. Start frontend:       cd frontend && npm run dev"
echo ""
echo "📖 Full docs: ./PRODUCTION.md"

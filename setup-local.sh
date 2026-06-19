#!/bin/bash
set -e

echo "📦 Installing WSM-Security dependencies..."
echo ""

# Backend
echo "📦 Installing backend dependencies..."
cd "$(dirname "$0")/backend/functions/server"
npm install dotenv
npm install

# Frontend
echo "📦 Installing frontend dependencies..."
cd "$(dirname "$0")/../../frontend"
npm install

echo ""
echo "✅ Dependencies installed!"
echo ""
echo "📝 Next steps:"
echo "1. Create .env file:"
echo "   cd backend/functions/server"
echo "   cp .env.example .env"
echo "   # Edit .env with your test OAuth credentials"
echo ""
echo "2. Start backend (Terminal 1):"
echo "   ./start-backend.sh"
echo ""
echo "3. Start frontend (Terminal 2):"
echo "   ./start-frontend.sh"
echo ""
echo "4. Open browser:"
echo "   http://localhost:3000"
echo ""

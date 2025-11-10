#!/bin/bash

# Production deployment script for full-stack Krea Realtime application

set -e

echo "🚀 Building Krea Realtime Full-Stack Application"

# Build frontend
echo "🎨 Building frontend..."
npm run build

# Install and prepare backend
echo "🔧 Preparing backend..."
cd server
npm ci --production

# Create production environment
if [ ! -f ".env.production" ]; then
    echo "📋 Creating production environment file..."
    cat > .env.production << EOF
PORT=3001
NODE_ENV=production
VIDEO_API_BASE=http://your-video-api-server:8000
LLM_API_BASE=http://your-llm-api-server:8001
TARGET_FPS=30
GENERATION_TIMEOUT=10000
LLM_CYCLE_INTERVAL=7000
LOG_LEVEL=info
CORS_ORIGIN=http://your-frontend-domain.com
EOF
fi

cd ..

echo "✅ Build completed successfully!"
echo ""
echo "📁 Deployment files:"
echo "  Frontend: ./dist/"
echo "  Backend: ./server/"
echo ""
echo "🌐 Production deployment instructions:"
echo "1. Copy ./dist/ to your web server (nginx, apache, etc.)"
echo "2. Copy ./server/ to your Node.js application server"
echo "3. Configure your video generation API endpoint"
echo "4. Update .env.production with correct API URLs"
echo "5. Start backend: cd server && npm start"
echo "6. Configure reverse proxy for /api/* to backend server"
echo ""
echo "🔧 Required services:"
echo "  - Video generation API with WHEP support"
echo "  - LLM API (optional, uses built-in bot otherwise)"
echo "  - WebSocket-capable load balancer if scaling"
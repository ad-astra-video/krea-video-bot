#!/bin/bash

# Production deployment script for Krea Realtime Web App

set -e

echo "🚀 Building Krea Realtime Web App for production..."

# Clean previous builds
rm -rf dist/

# Install dependencies
echo "📦 Installing dependencies..."
npm ci

# Run linting
echo "🔍 Running linter..."
npm run lint

# Build for production
echo "🏗️  Building application..."
npm run build

echo "✅ Build completed successfully!"
echo "📁 Static files are ready in ./dist/"
echo ""
echo "📋 Deployment Instructions:"
echo "1. Copy ./dist/ contents to your web server"
echo "2. Configure SSE endpoint at /api/stream"
echo "3. Serve files with proper MIME types"
echo ""
echo "🌐 For local testing:"
echo "npm run preview"
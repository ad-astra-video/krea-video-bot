#!/bin/bash

# Krea Realtime Full Stack Development Startup Script

echo "🚀 Starting Krea Realtime Development Environment"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Function to cleanup background processes
cleanup() {
    echo "🛑 Stopping all processes..."
    kill $SERVER_PID $CLIENT_PID 2>/dev/null
    exit 0
}

# Set up cleanup trap
trap cleanup SIGINT SIGTERM

# Start the backend server
echo "🔧 Starting Node.js backend server..."
cd server
if [ ! -d "node_modules" ]; then
    echo "📦 Installing server dependencies..."
    npm install
fi

# Copy environment file if it doesn't exist
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "📋 Created .env file from template"
fi

npm start &
SERVER_PID=$!

# Wait for server to start
echo "⏳ Waiting for server to start..."
sleep 3

# Check if server is running
if ! curl -f http://localhost:3001/health &> /dev/null; then
    echo "❌ Server failed to start. Check logs above."
    kill $SERVER_PID 2>/dev/null
    exit 1
fi

echo "✅ Server started successfully at http://localhost:3001"

# Start the frontend
echo "🎨 Starting React frontend..."
cd ..
if [ ! -d "node_modules" ]; then
    echo "📦 Installing frontend dependencies..."
    npm install
fi

npm run dev &
CLIENT_PID=$!

# Wait for frontend to start
echo "⏳ Waiting for frontend to start..."
sleep 5

echo ""
echo "🎉 Krea Realtime Development Environment Ready!"
echo ""
echo "📱 Frontend: http://localhost:5173"
echo "🔧 Backend API: http://localhost:3001"
echo "📊 Health Check: http://localhost:3001/health"
echo "🔌 WebSocket: ws://localhost:3001"
echo ""
echo "Press Ctrl+C to stop all services"

# Keep script running
wait $SERVER_PID $CLIENT_PID
import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import compression from 'compression';
import helmet from 'helmet';
import { WHEPClient } from './whep-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'krea-realtime-server' },
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ],
});

// Configuration
const CONFIG = {
  PORT: process.env.PORT || 3001,
  VIDEO_API_BASE: process.env.VIDEO_API_BASE || 'http://localhost:8000',
  LLM_API_BASE: process.env.LLM_API_BASE || 'http://localhost:8001',
  FRAME_RATE: 30, // Target FPS
  GENERATION_TIMEOUT: 10000, // 10 seconds
  LLM_CYCLE_INTERVAL: 7000, // 7 seconds
  WAITING_IMAGE_PATH: path.join(__dirname, 'assets', 'waiting.jpg'),
  FRONTEND_ENABLED: process.env.FRONTEND_ENABLED !== 'false' // Enable frontend by default
};

// Application state
class AppState {
  constructor() {
    this.clients = new Map(); // WebSocket clients
    this.messages = []; // Store messages for frontend rendering
    this.currentStream = null;
    this.currentVideo = null;
    this.streamStatus = 'idle'; // idle, starting, active, error
    this.llmBot = new LLMBot();
    this.frameStreamer = new FrameStreamer();
    this.lastFrameTime = 0;
    this.generationInProgress = false;
  }

  addClient(ws, id) {
    this.clients.set(id, ws);
    logger.info(`Client connected: ${id}`);
    
    // Send current state to new client
    this.sendToClient(id, {
      type: 'connection_established',
      data: {
        status: this.streamStatus,
        hasActiveStream: !!this.currentStream
      }
    });
  }

  removeClient(id) {
    this.clients.delete(id);
    logger.info(`Client disconnected: ${id}`);
  }

  broadcast(message) {
    // Store message for frontend rendering
    if (['thought', 'prompt', 'video_generation', 'error'].includes(message.type)) {
      this.messages.push({
        id: Date.now() + Math.random(),
        timestamp: Date.now(),
        type: message.type,
        content: message.content
      });
      
      // Keep only last 50 messages
      if (this.messages.length > 50) {
        this.messages = this.messages.slice(-50);
      }
    }

    const data = JSON.stringify(message);
    this.clients.forEach((ws, id) => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        try {
          ws.send(data);
        } catch (error) {
          logger.error(`Error sending to client ${id}:`, error);
          this.removeClient(id);
        }
      }
    });
  }

  sendToClient(clientId, message) {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error(`Error sending to client ${clientId}:`, error);
        this.removeClient(clientId);
      }
    }
  }
}

// LLM Bot class for managing AI conversation
class LLMBot {
  constructor() {
    this.conversationHistory = [];
    this.currentThought = '';
    this.lastPrompt = '';
    this.cycleInterval = null;
    this.thoughtPatterns = [
      "Analyzing visual aesthetics and trending motifs...",
      "Considering color palettes that evoke specific emotions...",
      "Exploring dynamic camera movements and transitions...",
      "Thinking about narrative elements to enhance engagement...",
      "Evaluating lighting conditions for dramatic effect...",
      "Contemplating abstract vs realistic visual approaches...",
      "Processing feedback from previous generations...",
      "Adjusting parameters for optimal visual impact..."
    ];
    this.promptTemplates = [
      "A {adjective} {setting} with {elements}, {style} style, {technical_specs}",
      "{action} in a {environment}, featuring {visual_elements}, {atmosphere}",
      "{concept} with {colors} and {effects}, {mood} lighting, {format}"
    ];
  }

  start() {
    logger.info('Starting LLM Bot cycle');
    this.cycleInterval = setInterval(() => {
      this.processCycle();
    }, CONFIG.LLM_CYCLE_INTERVAL);
    
    // Start immediately
    setTimeout(() => this.processCycle(), 1000);
  }

  stop() {
    if (this.cycleInterval) {
      clearInterval(this.cycleInterval);
      this.cycleInterval = null;
    }
    logger.info('LLM Bot cycle stopped');
  }

  async processCycle() {
    try {
      // Generate thought
      await this.generateThought();
      
      // Wait a bit, then generate prompt
      setTimeout(async () => {
        await this.generatePrompt();
        
        // Trigger video generation if no frames coming
        if (!appState.frameStreamer.hasActiveFrames()) {
          setTimeout(() => {
            videoGenerator.requestGeneration(this.lastPrompt);
          }, 2000);
        }
      }, 2000);
      
    } catch (error) {
      logger.error('Error in LLM cycle:', error);
      appState.broadcast({
        type: 'error',
        content: 'LLM processing error occurred',
        timestamp: Date.now()
      });
    }
  }

  async generateThought() {
    // Simulate LLM thinking process
    const thought = this.thoughtPatterns[Math.floor(Math.random() * this.thoughtPatterns.length)];
    this.currentThought = thought;
    
    appState.broadcast({
      type: 'thought',
      content: thought,
      timestamp: Date.now()
    });
    
    logger.info(`LLM Thought: ${thought}`);
  }

  async generatePrompt() {
    // Generate creative prompt based on current thought
    const adjectives = ['cyberpunk', 'ethereal', 'dramatic', 'surreal', 'vibrant', 'mystical'];
    const settings = ['cityscape', 'forest', 'ocean depths', 'space station', 'mountain peak', 'desert'];
    const elements = ['neon lights', 'floating particles', 'energy beams', 'crystal formations', 'smoke effects'];
    const styles = ['cinematic', '80s retro', 'abstract art', 'photorealistic', 'anime-inspired'];
    
    const template = this.promptTemplates[Math.floor(Math.random() * this.promptTemplates.length)];
    
    const prompt = template
      .replace('{adjective}', adjectives[Math.floor(Math.random() * adjectives.length)])
      .replace('{setting}', settings[Math.floor(Math.random() * settings.length)])
      .replace('{elements}', elements[Math.floor(Math.random() * elements.length)])
      .replace('{style}', styles[Math.floor(Math.random() * styles.length)])
      .replace('{technical_specs}', '4K resolution, smooth motion')
      .replace('{action}', 'Dynamic movement')
      .replace('{environment}', settings[Math.floor(Math.random() * settings.length)])
      .replace('{visual_elements}', elements[Math.floor(Math.random() * elements.length)])
      .replace('{atmosphere}', adjectives[Math.floor(Math.random() * adjectives.length)] + ' atmosphere')
      .replace('{concept}', 'Abstract visualization')
      .replace('{colors}', 'vibrant neon colors')
      .replace('{effects}', 'particle effects')
      .replace('{mood}', 'dramatic')
      .replace('{format}', 'seamless loop');

    this.lastPrompt = prompt;
    
    appState.broadcast({
      type: 'prompt',
      content: prompt,
      timestamp: Date.now()
    });
    
    logger.info(`Generated Prompt: ${prompt}`);
  }
}

// Video generation API handler
class VideoGenerator {
  constructor() {
    this.currentStreamId = null;
    this.whepConnection = null;
    this.generationTimeout = null;
  }

  async requestGeneration(prompt) {
    if (appState.generationInProgress) {
      logger.info('Generation already in progress, skipping');
      return;
    }

    try {
      appState.generationInProgress = true;
      appState.streamStatus = 'starting';
      
      appState.broadcast({
        type: 'video_generation',
        content: `Starting video generation: "${prompt}"`,
        timestamp: Date.now()
      });

      logger.info(`Requesting video generation with prompt: ${prompt}`);
      
      const response = await fetch(`${CONFIG.VIDEO_API_BASE}/ai/stream/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: prompt,
          quality: 'high',
          duration: 10
        })
      });

      if (!response.ok) {
        throw new Error(`Video API responded with status: ${response.status}`);
      }

      const data = await response.json();
      this.currentStreamId = data.stream_id;
      const whepUrl = data.whep_url;

      logger.info(`Video generation started. Stream ID: ${this.currentStreamId}, WHEP URL: ${whepUrl}`);
      
      appState.broadcast({
        type: 'video_generation',
        content: `Video generation initiated. Stream ID: ${this.currentStreamId}`,
        timestamp: Date.now()
      });

      // Start WHEP connection
      await this.startWhepConnection(whepUrl);
      
      // Set timeout for generation
      this.generationTimeout = setTimeout(() => {
        this.handleGenerationTimeout();
      }, CONFIG.GENERATION_TIMEOUT);

    } catch (error) {
      logger.error('Video generation request failed:', error);
      appState.streamStatus = 'error';
      appState.generationInProgress = false;
      
      appState.broadcast({
        type: 'error',
        content: `Video generation failed: ${error.message}`,
        timestamp: Date.now()
      });
    }
  }

  async startWhepConnection(whepUrl) {
    try {
      logger.info(`Connecting to WHEP endpoint: ${whepUrl}`);
      
      // Create WHEP client
      this.whepConnection = new WHEPClient(whepUrl, {
        timeout: CONFIG.GENERATION_TIMEOUT
      });

      // Set up event handlers
      this.whepConnection.onConnect = () => {
        appState.streamStatus = 'active';
        appState.currentStream = {
          id: this.currentStreamId,
          whepUrl: whepUrl,
          startTime: Date.now()
        };
        
        appState.generationInProgress = false;
        
        appState.broadcast({
          type: 'video_generation',
          content: 'WHEP connection established, receiving video frames',
          timestamp: Date.now()
        });
        
        logger.info('WHEP connection established successfully');
      };

      this.whepConnection.onFrame = (frameData) => {
        // Forward frame to frame streamer
        appState.frameStreamer.processIncomingFrame(frameData);
      };

      this.whepConnection.onError = (error) => {
        logger.error('WHEP connection error:', error);
        appState.streamStatus = 'error';
        
        appState.broadcast({
          type: 'error',
          content: `WHEP connection error: ${error.message}`,
          timestamp: Date.now()
        });
      };

      this.whepConnection.onDisconnect = (reason) => {
        logger.info(`WHEP disconnected: ${reason}`);
        appState.frameStreamer.stopReceiving();
        appState.streamStatus = 'idle';
        
        appState.broadcast({
          type: 'video_generation',
          content: `Stream disconnected: ${reason}`,
          timestamp: Date.now()
        });
      };

      // Attempt connection
      await this.whepConnection.connect();

    } catch (error) {
      logger.error('WHEP connection failed:', error);
      appState.streamStatus = 'error';
      appState.generationInProgress = false;
      
      appState.broadcast({
        type: 'error',
        content: `WHEP connection failed: ${error.message}`,
        timestamp: Date.now()
      });
      
      throw error;
    }
  }

  async checkStreamStatus() {
    if (!this.currentStreamId) return null;
    
    try {
      const response = await fetch(`${CONFIG.VIDEO_API_BASE}/ai/stream/${this.currentStreamId}/status`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      logger.error('Stream status check failed:', error);
    }
    return null;
  }

  handleGenerationTimeout() {
    logger.warn('Video generation timeout reached');
    appState.broadcast({
      type: 'error',
      content: 'Video generation timeout - retrying with adjusted parameters',
      timestamp: Date.now()
    });
    
    appState.streamStatus = 'idle';
    appState.generationInProgress = false;
    this.currentStreamId = null;
  }

  stopCurrentGeneration() {
    if (this.generationTimeout) {
      clearTimeout(this.generationTimeout);
      this.generationTimeout = null;
    }
    
    if (this.whepConnection) {
      this.whepConnection.disconnect();
      this.whepConnection = null;
    }
    
    appState.frameStreamer.stopReceiving();
    appState.streamStatus = 'idle';
    appState.currentStream = null;
    this.currentStreamId = null;
    appState.generationInProgress = false;
    
    logger.info('Video generation stopped');
  }
}

// Frame streaming handler
class FrameStreamer {
  constructor() {
    this.frameInterval = null;
    this.waitingImage = null;
    this.hasFrames = false;
    this.frameCount = 0;
    this.currentFrame = null; // Store current frame for frontend
    this.loadWaitingImage();
  }

  loadWaitingImage() {
    try {
      if (fs.existsSync(CONFIG.WAITING_IMAGE_PATH)) {
        this.waitingImage = fs.readFileSync(CONFIG.WAITING_IMAGE_PATH);
      } else {
        // Create a simple waiting image placeholder
        this.waitingImage = this.createWaitingImagePlaceholder();
      }
    } catch (error) {
      logger.error('Error loading waiting image:', error);
      this.waitingImage = this.createWaitingImagePlaceholder();
    }
  }

  createWaitingImagePlaceholder() {
    // Return a simple base64 encoded 1x1 pixel image as placeholder
    return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  }

  startReceiving(streamId) {
    this.hasFrames = true;
    this.frameCount = 0;
    
    logger.info(`Started receiving frames for stream: ${streamId}`);
  }

  processIncomingFrame(frameData) {
    if (!appState.currentStream) {
      return;
    }

    this.hasFrames = true;
    this.frameCount++;
    appState.lastFrameTime = Date.now();
    
    // Convert frame data to base64 for transmission
    const frameBase64 = frameData.data ? frameData.data.toString('base64') : null;
    
    // Store current frame for frontend rendering
    if (frameBase64) {
      this.currentFrame = `data:image/jpeg;base64,${frameBase64}`;
    }
    
    // Send frame to all connected clients
    appState.broadcast({
      type: 'frame',
      data: {
        streamId: appState.currentStream.id,
        frameNumber: this.frameCount,
        timestamp: Date.now(),
        width: frameData.width || 1920,
        height: frameData.height || 1080,
        frameData: frameBase64
      }
    });
  }

  processFrame(streamId) {
    if (!appState.currentStream || appState.currentStream.id !== streamId) {
      this.stopReceiving();
      return;
    }

    // Simulate processing a real frame
    this.frameCount++;
    appState.lastFrameTime = Date.now();
    
    // Send frame to all connected clients
    appState.broadcast({
      type: 'frame',
      data: {
        streamId: streamId,
        frameNumber: this.frameCount,
        timestamp: Date.now(),
        // In a real implementation, you'd send the actual frame data
        frameData: `frame_${this.frameCount}_${streamId}`
      }
    });

    // Simulate occasional frame drops or stream end
    if (Math.random() < 0.001) { // 0.1% chance
      logger.info('Simulated stream end');
      this.stopReceiving();
    }
  }

  stopReceiving() {
    if (this.frameInterval) {
      clearInterval(this.frameInterval);
      this.frameInterval = null;
    }
    this.hasFrames = false;
    logger.info('Stopped receiving frames');
  }

  hasActiveFrames() {
    return this.hasFrames && (Date.now() - appState.lastFrameTime < 5000);
  }

  sendWaitingFrame() {
    if (!this.hasActiveFrames()) {
      appState.broadcast({
        type: 'waiting_frame',
        data: {
          message: 'Waiting for video frames...',
          timestamp: Date.now()
        }
      });
    }
  }
}

// Initialize global instances
const appState = new AppState();
const videoGenerator = new VideoGenerator();

// Express app setup
const app = express();

// Security and performance middleware
app.use(helmet({
  contentSecurityPolicy: false // Allow inline scripts for WebSocket
}));
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Frontend setup (if enabled)
if (CONFIG.FRONTEND_ENABLED) {
  // Set view engine for server-side rendering
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  
  // Static files
  app.use('/static', express.static(path.join(__dirname, 'public')));
}

// Create HTTP server
const server = createServer(app);

// WebSocket server setup
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, request) => {
  const clientId = uuidv4();
  appState.addClient(ws, clientId);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      handleClientMessage(clientId, data);
    } catch (error) {
      logger.error('Error parsing client message:', error);
    }
  });

  ws.on('close', () => {
    appState.removeClient(clientId);
  });

  ws.on('error', (error) => {
    logger.error(`WebSocket error for client ${clientId}:`, error);
    appState.removeClient(clientId);
  });
});

// Handle client messages
function handleClientMessage(clientId, data) {
  switch (data.type) {
    case 'start_generation':
      if (data.prompt) {
        videoGenerator.requestGeneration(data.prompt);
      }
      break;
    case 'stop_generation':
      videoGenerator.stopCurrentGeneration();
      break;
    case 'get_status':
      appState.sendToClient(clientId, {
        type: 'status_response',
        data: {
          streamStatus: appState.streamStatus,
          hasActiveStream: !!appState.currentStream,
          frameStreaming: appState.frameStreamer.hasActiveFrames()
        }
      });
      break;
    default:
      logger.warn(`Unknown message type from client ${clientId}:`, data.type);
  }
}

// Frontend routes (if enabled)
if (CONFIG.FRONTEND_ENABLED) {
  // Helper functions for templates
  const templateHelpers = {
    getMessageIcon: (type) => {
      switch (type) {
        case 'thought': return '🧠';
        case 'prompt': return '✨';
        case 'video_generation': return '🎬';
        case 'error': return '⚠️';
        default: return '💭';
      }
    },
    formatTimestamp: (timestamp) => {
      return new Date(timestamp).toLocaleTimeString();
    }
  };

  // Main frontend route
  app.get('/', (req, res) => {
    // Get recent messages for initial render
    const recentMessages = Array.from(appState.clients.values())
      .map(() => appState.messages || [])
      .flat()
      .slice(-20); // Last 20 messages

    res.render('index', {
      title: 'Krea Realtime Generator',
      messages: recentMessages,
      currentVideo: appState.currentVideo,
      currentFrame: appState.frameStreamer?.currentFrame || null,
      isConnected: appState.clients.size > 0,
      streamStatus: appState.streamStatus,
      wsUrl: `ws://${req.get('host')}`,
      helpers: templateHelpers
    });
  });

  // Error page
  app.get('/error', (req, res) => {
    res.status(500).render('error', { 
      error: req.query.message || 'An unknown error occurred',
      title: 'Error - Krea Realtime Generator'
    });
  });
}

// REST API endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connections: appState.clients.size,
    streamStatus: appState.streamStatus,
    frontend: CONFIG.FRONTEND_ENABLED
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    streamStatus: appState.streamStatus,
    hasActiveStream: !!appState.currentStream,
    frameStreaming: appState.frameStreamer.hasActiveFrames(),
    connectedClients: appState.clients.size,
    frontend: {
      enabled: CONFIG.FRONTEND_ENABLED,
      messagesCount: appState.messages?.length || 0,
      hasCurrentFrame: !!appState.frameStreamer?.currentFrame
    },
    currentStream: appState.currentStream ? {
      id: appState.currentStream.id,
      startTime: appState.currentStream.startTime,
      duration: Date.now() - appState.currentStream.startTime
    } : null
  });
});

app.post('/api/generate', (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }
  
  videoGenerator.requestGeneration(prompt);
  res.json({ message: 'Generation requested', prompt });
});

// SSE endpoint for backward compatibility
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });

  const clientId = uuidv4();
  
  // Store SSE response in app state for broadcasting
  appState.clients.set(clientId + '_sse', {
    readyState: 1,
    send: (data) => {
      const message = JSON.parse(data);
      res.write(`data: ${JSON.stringify(message)}\n\n`);
    }
  });

  req.on('close', () => {
    appState.removeClient(clientId + '_sse');
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Express error:', err);
  
  if (CONFIG.FRONTEND_ENABLED) {
    res.status(500).render('error', { 
      error: err.message,
      title: 'Error - Krea Realtime Generator'
    });
  } else {
    res.status(500).json({ error: err.message });
  }
});

// 404 handler
app.use((req, res) => {
  if (CONFIG.FRONTEND_ENABLED) {
    res.status(404).render('error', { 
      error: 'Page not found',
      title: '404 - Krea Realtime Generator'
    });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Periodic tasks
function startPeriodicTasks() {
  // Send waiting frames every second when no active frames
  setInterval(() => {
    if (!appState.frameStreamer.hasActiveFrames()) {
      appState.frameStreamer.sendWaitingFrame();
    }
  }, 1000);

  // Check stream status every 30 seconds
  setInterval(async () => {
    if (videoGenerator.currentStreamId) {
      const status = await videoGenerator.checkStreamStatus();
      if (status) {
        logger.info('Stream status check:', status);
      }
    }
  }, 30000);
}

// Start the server
server.listen(CONFIG.PORT, () => {
  logger.info(`Krea Realtime Server running on port ${CONFIG.PORT}`);
  logger.info(`WebSocket endpoint: ws://localhost:${CONFIG.PORT}`);
  logger.info(`Health check: http://localhost:${CONFIG.PORT}/health`);
  
  // Start LLM bot and periodic tasks
  appState.llmBot.start();
  startPeriodicTasks();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  appState.llmBot.stop();
  videoGenerator.stopCurrentGeneration();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  appState.llmBot.stop();
  videoGenerator.stopCurrentGeneration();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
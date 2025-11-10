import wrtc from '@koush/wrtc';
import fetch from 'node-fetch';
import winston from 'winston';

const { RTCPeerConnection, RTCSessionDescription } = wrtc;

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.simple(),
  transports: [new winston.transports.Console()]
});

export class WHEPClient {
  constructor(whepUrl, options = {}) {
    this.whepUrl = whepUrl;
    this.options = {
      iceServers: options.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
      timeout: options.timeout || 10000,
      ...options
    };
    
    this.peerConnection = null;
    this.isConnected = false;
    this.onFrame = null;
    this.onError = null;
    this.onConnect = null;
    this.onDisconnect = null;
  }

  async connect() {
    try {
      logger.info(`Connecting to WHEP endpoint: ${this.whepUrl}`);
      
      // Create peer connection
      this.peerConnection = new RTCPeerConnection({
        iceServers: this.options.iceServers
      });

      // Set up event handlers
      this.setupPeerConnectionHandlers();

      // Create offer
      const offer = await this.peerConnection.createOffer({
        offerToReceiveVideo: true,
        offerToReceiveAudio: false
      });
      
      await this.peerConnection.setLocalDescription(offer);

      // Send offer to WHEP endpoint
      const response = await fetch(this.whepUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
          'Accept': 'application/sdp'
        },
        body: offer.sdp
      });

      if (!response.ok) {
        throw new Error(`WHEP handshake failed: ${response.status} ${response.statusText}`);
      }

      const answerSdp = await response.text();
      const answer = new RTCSessionDescription({
        type: 'answer',
        sdp: answerSdp
      });

      await this.peerConnection.setRemoteDescription(answer);
      
      logger.info('WHEP connection established');
      return true;

    } catch (error) {
      logger.error('WHEP connection failed:', error);
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }
  }

  setupPeerConnectionHandlers() {
    this.peerConnection.oniceconnectionstatechange = () => {
      const state = this.peerConnection.iceConnectionState;
      logger.info(`ICE connection state: ${state}`);
      
      if (state === 'connected' || state === 'completed') {
        this.isConnected = true;
        if (this.onConnect) {
          this.onConnect();
        }
      } else if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.isConnected = false;
        if (this.onDisconnect) {
          this.onDisconnect(state);
        }
      }
    };

    this.peerConnection.ontrack = (event) => {
      logger.info('Received media track');
      const stream = event.streams[0];
      
      if (stream && this.onFrame) {
        // Note: In a real implementation, you'd extract frames from the video track
        // This is a simplified version that simulates frame reception
        this.simulateFrameReception(stream);
      }
    };

    this.peerConnection.onicegatheringstatechange = () => {
      logger.info(`ICE gathering state: ${this.peerConnection.iceGatheringState}`);
    };

    this.peerConnection.onsignalingstatechange = () => {
      logger.info(`Signaling state: ${this.peerConnection.signalingState}`);
    };
  }

  simulateFrameReception(stream) {
    // Simulate frame extraction from video stream
    // In a real implementation, you'd use canvas or video processing libraries
    let frameCount = 0;
    
    const frameInterval = setInterval(() => {
      if (!this.isConnected || !this.onFrame) {
        clearInterval(frameInterval);
        return;
      }

      const frameData = {
        frameNumber: frameCount++,
        timestamp: Date.now(),
        width: 1920,
        height: 1080,
        // In real implementation, this would be actual frame buffer
        data: Buffer.alloc(1920 * 1080 * 3) // RGB placeholder
      };

      this.onFrame(frameData);
    }, 1000 / 30); // 30 FPS

    // Clean up interval when disconnected
    this.peerConnection.addEventListener('iceconnectionstatechange', () => {
      if (this.peerConnection.iceConnectionState === 'disconnected' || 
          this.peerConnection.iceConnectionState === 'closed') {
        clearInterval(frameInterval);
      }
    });
  }

  disconnect() {
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.isConnected = false;
    logger.info('WHEP connection closed');
  }

  getConnectionState() {
    return {
      isConnected: this.isConnected,
      iceConnectionState: this.peerConnection?.iceConnectionState,
      signalingState: this.peerConnection?.signalingState,
      iceGatheringState: this.peerConnection?.iceGatheringState
    };
  }
}

// Enhanced version with frame extraction capabilities
export class WHEPFrameExtractor extends WHEPClient {
  constructor(whepUrl, options = {}) {
    super(whepUrl, options);
    this.canvas = null;
    this.context = null;
    this.frameQueue = [];
    this.maxQueueSize = options.maxQueueSize || 10;
  }

  setupCanvas() {
    // Note: In Node.js, you'd use node-canvas for actual frame extraction
    // This is a placeholder implementation
    logger.info('Setting up canvas for frame extraction');
  }

  extractFrame(videoElement) {
    // Extract frame from video element to canvas
    // Convert to buffer and return
    if (!this.canvas || !this.context) {
      this.setupCanvas();
    }

    // Placeholder frame extraction logic
    const frameBuffer = Buffer.alloc(1920 * 1080 * 3);
    return {
      buffer: frameBuffer,
      width: 1920,
      height: 1080,
      timestamp: Date.now()
    };
  }

  getLatestFrame() {
    return this.frameQueue.length > 0 ? this.frameQueue[this.frameQueue.length - 1] : null;
  }

  getFrameQueue() {
    return [...this.frameQueue];
  }

  clearFrameQueue() {
    this.frameQueue = [];
  }
}
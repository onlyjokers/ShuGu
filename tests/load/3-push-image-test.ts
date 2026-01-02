#!/usr/bin/env node
/**
 * Test 3: Push Image Upload Test
 * 
 * Tests Push Image Upload throughput with high background client count
 */

import { io, Socket } from 'socket.io-client';
import { ClientSimulator } from './shared/client-simulator.js';
import { MetricsCollector } from './shared/metrics-collector.js';
import { delay, ProgressBar, formatBytes } from './shared/test-helpers.js';
import type { Message } from '@shugu/protocol';

interface PushImageTestOptions {
  serverUrl: string;
  backgroundClientCounts?: number[];
  imageFormat?: 'image/jpeg' | 'image/png' | 'image/webp';
  quality?: number;
  maxWidth?: number;
  durationSec?: number;
}

interface PushImageTestResult {
  backgroundClients: number;
  imageFormat: string;
  quality: number;
  maxWidth: number;
  avgImageSize: number;
  uploadRate: number;
  avgLatency: number;
  throughputBytesPerSec: number;
  backgroundLatencyIncrease: number;
}

class ManagerSimulator {
  private socket: Socket | null = null;
  private imageReceiveHandler: ((data: any) => void) | null = null;

  constructor(private serverUrl: string) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.serverUrl, {
        query: { role: 'manager' },
        transports: ['websocket', 'polling'],
        reconnection: false,
      });

      const timeout = setTimeout(() => {
        reject(new Error('Manager connection timeout'));
      }, 10000);

      this.socket.on('connect', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.socket.on('msg', (message: Message) => {
        if (message.type === 'data' && message.sensorType === 'camera') {
          this.imageReceiveHandler?.(message.payload);
        }
      });
    });
  }

  onImageReceived(handler: (data: any) => void): void {
    this.imageReceiveHandler = handler;
  }

  async sendPushImageRequest(
    targetClientId: string,
    format: string,
    quality: number,
    maxWidth: number,
    seq: number
  ): Promise<void> {
    if (!this.socket) throw new Error('Manager not connected');

    const message: Message = {
      type: 'control',
      from: 'manager',
      target: { mode: 'clientIds', ids: [targetClientId] },
      action: 'custom',
      timestamp: Date.now(),
      serverTimestamp: Date.now(),
      version: 1,
      payload: {
        kind: 'push-image-upload',
        format,
        quality,
        maxWidth,
        seq,
      } as any,
    };

    this.socket.emit('msg', message);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

async function testPushImageUpload(
  serverUrl: string,
  backgroundClientCount: number,
  options: Required<Pick<PushImageTestOptions, 'imageFormat' | 'quality' | 'maxWidth' | 'durationSec'>>
): Promise<PushImageTestResult> {
  const { imageFormat, quality, maxWidth, durationSec } = options;

  console.log(`\nSetting up ${backgroundClientCount} background clients...`);
  
  const backgroundClients: ClientSimulator[] = [];
  const backgroundMetrics = new MetricsCollector();
  const progress = new ProgressBar(backgroundClientCount, 'Connecting background clients');

  // Connect background clients
  for (let i = 0; i < backgroundClientCount; i++) {
    const client = new ClientSimulator({
      serverUrl,
      onMessage: (message: Message) => {
        // Track background latency
        if (message.type === 'control') {
          const sentTime = message.timestamp || message.serverTimestamp || 0;
          const receivedTime = Date.now();
          const latency = receivedTime - sentTime;
          
          if (latency >= 0 && latency < 60000) {
            backgroundMetrics.recordLatency(latency);
          }
        }
      },
    });

    try {
      await client.connect();
      backgroundClients.push(client);
    } catch (error) {
      console.error(`Failed to connect background client ${i}:`, error);
    }

    progress.update(i + 1);
    await delay(30);
  }

  console.log(`\n✓ Connected ${backgroundClients.length}/${backgroundClientCount} background clients`);
  
  // Measure baseline latency
  console.log('\nMeasuring baseline latency...');
  await delay(3000);
  const baselineMetrics = backgroundMetrics.getLatencyMetrics();
  backgroundMetrics.reset();

  // Connect test client for Push Image
  console.log('Connecting test client...');
  const uploadMetrics = new MetricsCollector();
  const imageSizes: number[] = [];
  let uploadCount = 0;
  
  const testClient = new ClientSimulator({
    serverUrl,
    onMessage: () => {}, // Test client just responds to push image requests
  });

  const testClientId = await testClient.connect();
  console.log(`✓ Test client connected: ${testClientId}\n`);

  // Connect manager
  console.log('Connecting manager...');
  const manager = new ManagerSimulator(serverUrl);
  await manager.connect();
  
  const uploadLatencies: number[] = [];
  const uploadTimes: number[] = [];
  
  manager.onImageReceived((data: any) => {
    const receivedTime = Date.now();
    const seq = data.seq;
    
    if (uploadTimes[seq]) {
      const latency = receivedTime - uploadTimes[seq];
      uploadLatencies.push(latency);
      uploadMetrics.recordLatency(latency);
    }
    
    if (data.dataUrl && typeof data.dataUrl === 'string') {
      const size = data.dataUrl.length;
      imageSizes.push(size);
      uploadMetrics.recordMessage(size);
    }
    
    uploadCount++;
  });

  console.log('✓ Manager connected\n');
  await delay(1000);

  // Start Push Image upload test
  console.log(`Starting Push Image upload test for ${durationSec}s...`);
  console.log(`Format: ${imageFormat}, Quality: ${quality}, Max Width: ${maxWidth}\n`);

  const startTime = Date.now();
  let seq = 0;

  const uploadInterval = setInterval(async () => {
    uploadTimes[seq] = Date.now();
    await manager.sendPushImageRequest(testClientId, imageFormat, quality, maxWidth, seq);
    seq++;
  }, 1000); // Request 1 fps

  // Run for specified duration
  await delay(durationSec * 1000);
  clearInterval(uploadInterval);

  // Wait for final uploads
  await delay(2000);

  const elapsedSec = (Date.now() - startTime) / 1000;
  const uploadRate = uploadCount / elapsedSec;
  const avgImageSize = imageSizes.length > 0
    ? imageSizes.reduce((sum, s) => sum + s, 0) / imageSizes.length
    : 0;
  
  const avgLatency = uploadLatencies.length > 0
    ? uploadLatencies.reduce((sum, l) => sum + l, 0) / uploadLatencies.length
    : 0;

  const throughput = uploadMetrics.getThroughputMetrics();
  
  // Measure background latency during upload
  const duringMetrics = backgroundMetrics.getLatencyMetrics();
  const latencyIncrease = duringMetrics.avg - baselineMetrics.avg;

  // Cleanup
  console.log('\nDisconnecting...');
  manager.disconnect();
  testClient.disconnect();
  for (const client of backgroundClients) {
    client.disconnect();
  }

  return {
    backgroundClients: backgroundClientCount,
    imageFormat,
    quality,
    maxWidth,
    avgImageSize,
    uploadRate,
    avgLatency,
    throughputBytesPerSec: throughput.bytesPerSec,
    backgroundLatencyIncrease: latencyIncrease,
  };
}

async function runPushImageTest(options: PushImageTestOptions): Promise<void> {
  const {
    serverUrl,
    backgroundClientCounts = [100, 150, 200, 250],
    imageFormat = 'image/jpeg',
    quality = 0.85,
    maxWidth = 960,
    durationSec = 10,
  } = options;

  console.log('\n═══════════════════════════════════════');
  console.log('Push Image Upload Test');
  console.log('═══════════════════════════════════════');
  console.log(`Server: ${serverUrl}`);
  console.log(`Background client counts: ${backgroundClientCounts.join(', ')}`);
  console.log(`Image format: ${imageFormat}`);
  console.log(`Quality: ${quality}`);
  console.log(`Max width: ${maxWidth}`);
  console.log('═══════════════════════════════════════\n');

  const results: PushImageTestResult[] = [];

  for (const clientCount of backgroundClientCounts) {
    console.log(`\n--- Testing with ${clientCount} background clients ---`);
    
    const result = await testPushImageUpload(serverUrl, clientCount, {
      imageFormat,
      quality,
      maxWidth,
      durationSec,
    });
    
    results.push(result);

    console.log(`\n📊 Results:`);
    console.log(`   Upload rate: ${result.uploadRate.toFixed(2)} fps`);
    console.log(`   Avg image size: ${formatBytes(result.avgImageSize)}`);
    console.log(`   Avg latency: ${result.avgLatency.toFixed(0)}ms`);
    console.log(`   Throughput: ${formatBytes(result.throughputBytesPerSec)}/s`);
    console.log(`   Background latency increase: +${result.backgroundLatencyIncrease.toFixed(0)}ms`);

    // Wait between tests
    await delay(5000);
  }

  // Display summary
  console.log('\n\n═══════════════════════════════════════');
  console.log('Push Image Upload Test Summary');
  console.log('═══════════════════════════════════════\n');

  for (const result of results) {
    console.log(`${result.backgroundClients} background clients:`);
    console.log(`  Rate: ${result.uploadRate.toFixed(2)} fps | Latency: ${result.avgLatency.toFixed(0)}ms | Size: ${formatBytes(result.avgImageSize)} | Impact: +${result.backgroundLatencyIncrease.toFixed(0)}ms`);
  }

  console.log('');

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fs = await import('fs/promises');
  const path = await import('path');
  const resultsPath = path.join(process.cwd(), 'test-results', `push-image-test-${timestamp}.json`);
  
  await fs.writeFile(
    resultsPath,
    JSON.stringify({ results }, null, 2)
  );
  
  console.log(`📊 Results saved to: ${resultsPath}\n`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const serverUrl = args.find((arg) => arg.startsWith('--server-url='))?.split('=')[1] || 'https://localhost:3001';
const backgroundClientsArg = args.find((arg) => arg.startsWith('--background-clients='))?.split('=')[1];
const backgroundClientCounts = backgroundClientsArg?.split(',').map(Number) || [100, 150, 200, 250];

runPushImageTest({ serverUrl, backgroundClientCounts }).catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});

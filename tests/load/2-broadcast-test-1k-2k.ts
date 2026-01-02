#!/usr/bin/env node
/**
 * Test 2b: Broadcast Performance Test (1KB & 2KB messages)
 * 
 * Measures broadcast latency for 1KB and 2KB messages at 250 clients
 */

import { io, Socket } from 'socket.io-client';
import { ClientSimulator } from './shared/client-simulator.js';
import { MetricsCollector } from './shared/metrics-collector.js';
import { delay, ProgressBar, formatBytes } from './shared/test-helpers.js';
import type { Message } from '@shugu/protocol';

interface BroadcastTestOptions {
  serverUrl: string;
  clientCount?: number;
  messageSizes?: number[];
}

interface BroadcastTestResult {
  clientCount: number;
  messageSize: number;
  latencyMetrics: ReturnType<MetricsCollector['getLatencyMetrics']>;
}

class ManagerSimulator {
  private socket: Socket | null = null;

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
    });
  }

  async broadcastMessage(message: Message): Promise<void> {
    if (!this.socket) throw new Error('Manager not connected');
    this.socket.emit('msg', message);
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

function createTestMessage(targetSize: number): Message {
  const timestamp = Date.now();

  // Create a base message structure
  const baseMessage: Message = {
    type: 'control',
    from: 'manager',
    target: { mode: 'all' },
    action: 'custom',
    timestamp,
    serverTimestamp: timestamp,
    version: 1,
    payload: {
      kind: 'test-message',
      data: '',
    } as any,
  };

  // Calculate the size of the base message
  const baseSize = JSON.stringify(baseMessage).length;
  
  // Calculate how much padding we need to reach target size
  const paddingNeeded = Math.max(0, targetSize - baseSize);
  
  // Add padding with random-like characters to simulate real data
  const padding = 'x'.repeat(paddingNeeded);
  
  return {
    ...baseMessage,
    payload: {
      kind: 'test-message',
      data: padding,
    } as any,
  };
}

async function testBroadcastLatency(
  serverUrl: string,
  clientCount: number,
  messageSize: number,
  keepAlive = false
): Promise<{
  result: BroadcastTestResult;
  clients: ClientSimulator[];
  manager: ManagerSimulator;
}> {
  console.log(`\nSetting up ${clientCount} clients...`);
  
  const clients: ClientSimulator[] = [];
  const metrics = new MetricsCollector();
  const progress = new ProgressBar(clientCount, 'Connecting clients');

  // Connect clients
  for (let i = 0; i < clientCount; i++) {
    const client = new ClientSimulator({
      serverUrl,
      onMessage: (message: Message) => {
        // Calculate latency
        if (message.type === 'control') {
          const sentTime = message.timestamp || message.serverTimestamp || 0;
          const receivedTime = Date.now();
          const latency = receivedTime - sentTime;
          
          if (latency >= 0 && latency < 60000) { // Sanity check
            metrics.recordLatency(latency);
          }
        }
      },
    });

    try {
      await client.connect();
      clients.push(client);
    } catch (error) {
      console.error(`Failed to connect client ${i}:`, error);
    }

    progress.update(i + 1);
    await delay(30); // Slower ramp to avoid overwhelming server
  }

  console.log(`\n✓ Connected ${clients.length}/${clientCount} clients`);
  await delay(2000); // Stabilize

  // Connect manager
  console.log('Connecting manager...');
  const manager = new ManagerSimulator(serverUrl);
  await manager.connect();
  console.log('✓ Manager connected\n');

  await delay(1000);

  // Broadcast test message multiple times
  const numBroadcasts = 10;
  const message = createTestMessage(messageSize);
  const actualSize = JSON.stringify(message).length;

  console.log(`Broadcasting ${numBroadcasts} messages (target: ${formatBytes(messageSize)}, actual: ${formatBytes(actualSize)})...`);
  
  for (let i = 0; i < numBroadcasts; i++) {
    const testMessage = {
      ...message,
      timestamp: Date.now(),
      serverTimestamp: Date.now(),
    };
    
    await manager.broadcastMessage(testMessage);
    await delay(500); // Space out broadcasts
  }

  // Wait for messages to arrive
  await delay(2000);

  if (!keepAlive) {
    // Cleanup
    console.log('Disconnecting...');
    manager.disconnect();
    for (const client of clients) {
      client.disconnect();
    }
  }

  const latencyMetrics = metrics.getLatencyMetrics();

  return {
    result: {
      clientCount,
      messageSize: actualSize,
      latencyMetrics,
    },
    clients,
    manager,
  };
}

async function runBroadcastTest(options: BroadcastTestOptions): Promise<void> {
  const {
    serverUrl,
    clientCount = 250,
    messageSizes = [1024, 2048], // 1KB, 2KB
  } = options;

  console.log('\n═══════════════════════════════════════');
  console.log('Broadcast Test (1KB & 2KB @ 250 clients)');
  console.log('═══════════════════════════════════════');
  console.log(`Server: ${serverUrl}`);
  console.log(`Client count: ${clientCount}`);
  console.log(`Message sizes: ${messageSizes.map(s => formatBytes(s)).join(', ')}`);
  console.log('═══════════════════════════════════════\n');

  const results: BroadcastTestResult[] = [];
  let allClients: ClientSimulator[] = [];
  let manager: ManagerSimulator | null = null;

  for (let i = 0; i < messageSizes.length; i++) {
    const messageSize = messageSizes[i];
    const isLastMessageSize = i === messageSizes.length - 1;

    console.log(`\n--- Testing ${clientCount} clients with ${formatBytes(messageSize)} messages ---`);
    
    const { result, clients, manager: mgr } = await testBroadcastLatency(
      serverUrl,
      clientCount,
      messageSize,
      isLastMessageSize
    );
    results.push(result);

    if (isLastMessageSize) {
      allClients = clients;
      manager = mgr;
    }

    console.log(`\n📊 Results:`);
    console.log(`   Messages received: ${result.latencyMetrics.count}`);
    console.log(`   Average latency: ${result.latencyMetrics.avg.toFixed(0)}ms`);
    console.log(`   p50 latency: ${result.latencyMetrics.p50.toFixed(0)}ms`);
    console.log(`   p95 latency: ${result.latencyMetrics.p95.toFixed(0)}ms`);
    console.log(`   p99 latency: ${result.latencyMetrics.p99.toFixed(0)}ms`);
    console.log(`   Max latency: ${result.latencyMetrics.max.toFixed(0)}ms`);

    // If this is the last message size, break
    if (isLastMessageSize) {
      console.log('\n✅ Test complete - keeping connections alive');
      console.log(`📊 ${allClients.length} clients + 1 manager currently connected`);
      break;
    }

    // Wait between tests
    await delay(5000);
  }

  // Display summary
  console.log('\n\n═══════════════════════════════════════');
  console.log('Test Summary');
  console.log('═══════════════════════════════════════\n');

  for (const result of results) {
    console.log(`${formatBytes(result.messageSize)} messages:`);
    console.log(`  Avg: ${result.latencyMetrics.avg.toFixed(0)}ms | p95: ${result.latencyMetrics.p95.toFixed(0)}ms | p99: ${result.latencyMetrics.p99.toFixed(0)}ms | Max: ${result.latencyMetrics.max.toFixed(0)}ms`);
  }

  console.log('');

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fs = await import('fs/promises');
  const path = await import('path');
  const resultsPath = path.join(process.cwd(), 'test-results', `broadcast-1k-2k-test-${timestamp}.json`);
  
  await fs.writeFile(
    resultsPath,
    JSON.stringify({ clientCount, results }, null, 2)
  );
  
  console.log(`📊 Results saved to: ${resultsPath}\n`);

  // If we have clients and manager connected, keep them alive
  if (allClients.length > 0 && manager) {
    console.log('═══════════════════════════════════════');
    console.log(`🔌 Keeping ${allClients.length} clients + manager connected`);
    console.log('Press Ctrl+C to disconnect and exit');
    console.log('═══════════════════════════════════════\n');

    // Setup cleanup handler
    process.on('SIGINT', () => {
      console.log('\n\nDisconnecting all clients and manager...');
      manager?.disconnect();
      for (const client of allClients) {
        client.disconnect();
      }
      console.log('✅ All connections closed');
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {}); // Wait forever until Ctrl+C
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const serverUrl = args.find((arg) => arg.startsWith('--server-url='))?.split('=')[1] || 'https://localhost:3001';
const clientCount = parseInt(args.find((arg) => arg.startsWith('--clients='))?.split('=')[1] || '250');

runBroadcastTest({ serverUrl, clientCount }).catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});

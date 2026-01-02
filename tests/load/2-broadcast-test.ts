#!/usr/bin/env node
/**
 * Test 2: Broadcast Performance Test
 * 
 * Measures broadcast latency at various client counts
 */

import { io, Socket } from 'socket.io-client';
import { ClientSimulator } from './shared/client-simulator.js';
import { MetricsCollector } from './shared/metrics-collector.js';
import { delay, ProgressBar, formatBytes } from './shared/test-helpers.js';
import type { Message } from '@shugu/protocol';

interface BroadcastTestOptions {
  serverUrl: string;
  clientCounts?: number[];
  messageTypes?: string[];
}

interface BroadcastTestResult {
  clientCount: number;
  messageType: string;
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

function createTestMessage(type: string): Message {
  const timestamp = Date.now();

  if (type === 'small') {
    // Small message: screenColor (~0.5KB)
    return {
      type: 'control',
      from: 'manager',
      target: { mode: 'all' },
      action: 'screenColor',
      timestamp,
      serverTimestamp: timestamp,
      version: 1,
      payload: {
        color: '#6366f1',
        opacity: 0.8,
        mode: 'solid',
      },
    } as Message;
  } else if (type === 'medium') {
    // Medium message: visualScenes with effects (~5KB)
    return {
      type: 'control',
      from: 'manager',
      target: { mode: 'all' },
      action: 'visualScenes',
      timestamp,
      serverTimestamp: timestamp,
      version: 1,
      payload: {
        scenes: [
          { type: 'box' },
          { type: 'mel' },
        ],
      },
    } as Message;
  } else {
    // Large message: showImage with DataURL (~100KB)
    const sampleDataUrl = 'data:image/jpeg;base64,' + 'A'.repeat(100000);
    return {
      type: 'control',
      from: 'manager',
      target: { mode: 'all' },
      action: 'showImage',
      timestamp,
      serverTimestamp: timestamp,
      version: 1,
      payload: {
        url: sampleDataUrl,
      },
    } as Message;
  }
}

async function testBroadcastLatency(
  serverUrl: string,
  clientCount: number,
  messageType: string,
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
  const message = createTestMessage(messageType);
  const messageSize = JSON.stringify(message).length;

  console.log(`Broadcasting ${numBroadcasts} ${messageType} messages (${formatBytes(messageSize)} each)...`);
  
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
      messageType,
      messageSize,
      latencyMetrics,
    },
    clients,
    manager,
  };
}

async function runBroadcastTest(options: BroadcastTestOptions): Promise<void> {
  const {
    serverUrl,
    clientCounts = [50, 100, 150, 200, 250],
    messageTypes = ['small', 'medium', 'large'],
  } = options;

  console.log('\n═══════════════════════════════════════');
  console.log('Broadcast Performance Test');
  console.log('═══════════════════════════════════════');
  console.log(`Server: ${serverUrl}`);
  console.log(`Client counts: ${clientCounts.join(', ')}`);
  console.log(`Message types: ${messageTypes.join(', ')}`);
  console.log('═══════════════════════════════════════\n');

  const results: BroadcastTestResult[] = [];
  let allClients: ClientSimulator[] = [];
  let manager: ManagerSimulator | null = null;

  const maxClientCount = Math.max(...clientCounts);

  for (let i = 0; i < clientCounts.length; i++) {
    const clientCount = clientCounts[i];
    const isMaxLevel = clientCount === maxClientCount;

    for (let j = 0; j < messageTypes.length; j++) {
      const messageType = messageTypes[j];
      const isLastMessageType = j === messageTypes.length - 1;
      const shouldKeepAlive = isMaxLevel && isLastMessageType;

      console.log(`\n--- Testing ${clientCount} clients with ${messageType} messages ---`);
      
      const { result, clients, manager: mgr } = await testBroadcastLatency(
        serverUrl,
        clientCount,
        messageType,
        shouldKeepAlive
      );
      results.push(result);

      if (shouldKeepAlive) {
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

      // If this is the max level and last message type, break
      if (shouldKeepAlive) {
        console.log('\n✅ Reached maximum test level - keeping connections alive');
        console.log(`📊 ${allClients.length} clients + 1 manager currently connected`);
        break;
      }

      // Wait between tests
      await delay(5000);
    }

    if (manager) break; // Exit outer loop if we're keeping connections
  }

  // Display summary
  console.log('\n\n═══════════════════════════════════════');
  console.log('Broadcast Performance Test Summary');
  console.log('═══════════════════════════════════════\n');

  for (const result of results) {
    console.log(`${result.clientCount} clients, ${result.messageType} (${formatBytes(result.messageSize)}):`);
    console.log(`  Avg: ${result.latencyMetrics.avg.toFixed(0)}ms | p95: ${result.latencyMetrics.p95.toFixed(0)}ms | p99: ${result.latencyMetrics.p99.toFixed(0)}ms | Max: ${result.latencyMetrics.max.toFixed(0)}ms`);
  }

  console.log('');

  // Save results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fs = await import('fs/promises');
  const path = await import('path');
  const resultsPath = path.join(process.cwd(), 'test-results', `broadcast-test-${timestamp}.json`);
  
  await fs.writeFile(
    resultsPath,
    JSON.stringify({ results }, null, 2)
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
const clientCountsArg = args.find((arg) => arg.startsWith('--clients='))?.split('=')[1];
const clientCounts = clientCountsArg?.split(',').map(Number) || [50, 100, 150, 200, 250];

runBroadcastTest({ serverUrl, clientCounts }).catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});

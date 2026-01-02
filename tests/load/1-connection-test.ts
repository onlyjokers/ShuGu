#!/usr/bin/env node
/**
 * Test 1: Basic Connection Load Test
 * 
 * Determines the maximum number of concurrent client connections
 * the server can handle.
 */

import { ClientSimulator } from './shared/client-simulator.js';
import { MetricsCollector } from './shared/metrics-collector.js';
import { delay, ProgressBar } from './shared/test-helpers.js';

interface ConnectionTestOptions {
  serverUrl: string;
  maxClients?: number;
  rampStep?: number;
  rampIntervalMs?: number;
}

interface ConnectionTestResult {
  clientCount: number;
  metrics: ReturnType<MetricsCollector['getConnectionMetrics']>;
}

async function testConnectionAtLevel(
  serverUrl: string,
  clientCount: number,
  rampIntervalMs: number,
  keepAlive = false
): Promise<{ result: ConnectionTestResult; clients: ClientSimulator[] }> {
  const metrics = new MetricsCollector();
  const clients: ClientSimulator[] = [];
  const progress = new ProgressBar(clientCount, `Connecting ${clientCount} clients`);

  for (let i = 0; i < clientCount; i++) {
    const client = new ClientSimulator({ serverUrl });
    const startTime = Date.now();

    try {
      await client.connect();
      const connectionTime = Date.now() - startTime;
      metrics.recordConnection(true, connectionTime);
      clients.push(client);
    } catch (error) {
      const connectionTime = Date.now() - startTime;
      metrics.recordConnection(false, connectionTime);
    }

    progress.update(i + 1);

    if (i < clientCount - 1) {
      await delay(rampIntervalMs);
    }
  }

  // Keep connections alive for a moment to test stability
  await delay(2000);

  if (!keepAlive) {
    // Disconnect all clients
    console.log('Disconnecting clients...');
    for (const client of clients) {
      client.disconnect();
    }
  }

  return {
    result: {
      clientCount,
      metrics: metrics.getConnectionMetrics(),
    },
    clients,
  };
}

function analyzeResults(results: ConnectionTestResult[]): {
  comfortableCapacity: number;
  maximumCapacity: number;
  recommendedLimit: number;
} {
  // Comfortable capacity: 95%+ success, <1s avg connection time
  let comfortableCapacity = 0;
  for (const result of results) {
    if (
      result.metrics.successRate >= 95 &&
      result.metrics.avgConnectionTime < 1000
    ) {
      comfortableCapacity = result.clientCount;
    } else {
      break;
    }
  }

  // Maximum capacity: 50%+ success rate
  let maximumCapacity = 0;
  for (const result of results) {
    if (result.metrics.successRate >= 50) {
      maximumCapacity = result.clientCount;
    } else {
      break;
    }
  }

  // Recommended: 80% of comfortable
  const recommendedLimit = Math.floor(comfortableCapacity * 0.8);

  return { comfortableCapacity, maximumCapacity, recommendedLimit };
}

async function runConnectionTest(options: ConnectionTestOptions): Promise<void> {
  const {
    serverUrl,
    maxClients = 250,
    rampStep = 50,
    rampIntervalMs = 50,
  } = options;

  console.log('\n═══════════════════════════════════════');
  console.log('Connection Load Test');
  console.log('═══════════════════════════════════════');
  console.log(`Server: ${serverUrl}`);
  console.log(`Max clients: ${maxClients}`);
  console.log(`Ramp step: ${rampStep}`);
  console.log('═══════════════════════════════════════\n');

  const results: ConnectionTestResult[] = [];
  const levels = [10, 50, 100, 150, 200, 250].filter(
    (n) => n <= maxClients
  );

  let allClients: ClientSimulator[] = [];

  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    const isMaxLevel = level === maxClients || i === levels.length - 1;
    
    console.log(`\n--- Testing ${level} clients ---`);
    const { result, clients } = await testConnectionAtLevel(serverUrl, level, rampIntervalMs, isMaxLevel);
    results.push(result);

    if (isMaxLevel) {
      allClients = clients;
    }

    console.log(`Success rate: ${result.metrics.successRate.toFixed(1)}%`);
    console.log(`Avg connection time: ${result.metrics.avgConnectionTime.toFixed(0)}ms`);
    console.log(`Min connection time: ${result.metrics.minConnectionTime.toFixed(0)}ms`);
    console.log(`Max connection time: ${result.metrics.maxConnectionTime.toFixed(0)}ms`);

    // If this is the max level, keep connections and display results immediately
    if (isMaxLevel) {
      console.log('\n✅ Reached maximum test level - keeping connections alive');
      console.log(`📊 ${allClients.length} clients currently connected`);
      break;
    }

    // Stop if we hit failure threshold
    if (result.metrics.successRate < 50 || result.metrics.avgConnectionTime > 5000) {
      console.log('\n⚠️  Reached failure threshold, stopping test');
      break;
    }

    // Wait between levels
    await delay(3000);
  }

  // Analyze and display results
  console.log('\n\n═══════════════════════════════════════');
  console.log('Connection Load Test Results');
  console.log('═══════════════════════════════════════\n');

  const analysis = analyzeResults(results);

  console.log(`✅ Comfortable Capacity: ${analysis.comfortableCapacity} clients`);
  if (analysis.comfortableCapacity > 0) {
    const comfortable = results.find((r) => r.clientCount === analysis.comfortableCapacity);
    if (comfortable) {
      console.log(`   - Success rate: ${comfortable.metrics.successRate.toFixed(1)}%`);
      console.log(`   - Avg connection time: ${comfortable.metrics.avgConnectionTime.toFixed(0)}ms`);
    }
  }

  console.log(`\n⚡ Maximum Capacity: ${analysis.maximumCapacity} clients`);
  if (analysis.maximumCapacity > 0) {
    const maximum = results.find((r) => r.clientCount === analysis.maximumCapacity);
    if (maximum) {
      console.log(`   - Success rate: ${maximum.metrics.successRate.toFixed(1)}%`);
      console.log(`   - Avg connection time: ${maximum.metrics.avgConnectionTime.toFixed(0)}ms`);
    }
  }

  console.log(`\n💡 Recommended Limit: ${analysis.recommendedLimit} clients`);
  console.log('   (80% of comfortable capacity)\n');

  // Save results to JSON
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fs = await import('fs/promises');
  const path = await import('path');
  const resultsPath = path.join(process.cwd(), 'test-results', `connection-test-${timestamp}.json`);
  
  await fs.writeFile(
    resultsPath,
    JSON.stringify({ results, analysis }, null, 2)
  );
  
  console.log(`📊 Results saved to: ${resultsPath}\n`);

  // If we have clients connected, keep them alive
  if (allClients.length > 0) {
    console.log('═══════════════════════════════════════');
    console.log(`🔌 Keeping ${allClients.length} connections alive`);
    console.log('Press Ctrl+C to disconnect and exit');
    console.log('═══════════════════════════════════════\n');

    // Setup cleanup handler
    process.on('SIGINT', () => {
      console.log('\n\nDisconnecting all clients...');
      for (const client of allClients) {
        client.disconnect();
      }
      console.log('✅ All clients disconnected');
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {}); // Wait forever until Ctrl+C
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const serverUrl = args.find((arg) => arg.startsWith('--server-url='))?.split('=')[1] || 'https://localhost:3001';
const maxClients = parseInt(args.find((arg) => arg.startsWith('--max-clients='))?.split('=')[1] || '250');

runConnectionTest({ serverUrl, maxClients }).catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});

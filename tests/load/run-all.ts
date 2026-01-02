#!/usr/bin/env node
/**
 * Test Runner - Runs all load tests in sequence
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  serverUrl: string;
  tests: {
    connection: {
      enabled: boolean;
      maxClients: number;
    };
    broadcast: {
      enabled: boolean;
      clientCounts: number[];
    };
    pushImage: {
      enabled: boolean;
      backgroundClientCounts: number[];
    };
  };
}

const DEFAULT_CONFIG: TestConfig = {
  serverUrl: 'https://localhost:3001',
  tests: {
    connection: {
      enabled: true,
      maxClients: 250,
    },
    broadcast: {
      enabled: true,
      clientCounts: [50, 100, 150, 200, 250],
    },
    pushImage: {
      enabled: true,
      backgroundClientCounts: [100, 150, 200, 250],
    },
  },
};

function parseConfig(): TestConfig {
  const args = process.argv.slice(2);
  const configPath = args.find((arg) => arg.startsWith('--config='))?.split('=')[1];
  
  if (configPath && existsSync(configPath)) {
    try {
      const configContent = require('fs').readFileSync(configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      console.warn('Failed to load config file, using defaults:', error);
      return DEFAULT_CONFIG;
    }
  }

  // Parse from command line
  const serverUrl = args.find((arg) => arg.startsWith('--server-url='))?.split('=')[1] || DEFAULT_CONFIG.serverUrl;
  
  return {
    serverUrl,
    tests: DEFAULT_CONFIG.tests,
  };
}

async function runTest(
  testName: string,
  script: string,
  args: string[]
): Promise<boolean> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running ${testName}...`);
  console.log(`${'='.repeat(60)}\n`);

  try {
    const command = `tsx ${script} ${args.join(' ')}`;
    execSync(command, {
      stdio: 'inherit',
      cwd: process.cwd(),
    });
    
    console.log(`\n✅ ${testName} completed successfully\n`);
    return true;
  } catch (error) {
    console.error(`\n❌ ${testName} failed:`, error);
    return false;
  }
}

async function runAllTests(): Promise<void> {
  const config = parseConfig();

  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║   ShuGu Server Load Test Suite       ║');
  console.log('╚═══════════════════════════════════════╝\n');
  console.log(`Server URL: ${config.serverUrl}\n`);

  // Ensure results directory exists
  const resultsDir = join(process.cwd(), 'test-results');
  if (!existsSync(resultsDir)) {
    mkdirSync(resultsDir, { recursive: true });
  }

  const results: { name: string; success: boolean }[] = [];

  // Test 1: Connection Load
  if (config.tests.connection.enabled) {
    const success = await runTest(
      'Connection Load Test',
      '1-connection-test.ts',
      [
        `--server-url=${config.serverUrl}`,
        `--max-clients=${config.tests.connection.maxClients}`,
      ]
    );
    results.push({ name: 'Connection Load Test', success });
    
    // Wait between tests
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  // Test 2: Broadcast Performance
  if (config.tests.broadcast.enabled) {
    const success = await runTest(
      'Broadcast Performance Test',
      '2-broadcast-test.ts',
      [
        `--server-url=${config.serverUrl}`,
        `--clients=${config.tests.broadcast.clientCounts.join(',')}`,
      ]
    );
    results.push({ name: 'Broadcast Performance Test', success });
    
    // Wait between tests
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  // Test 3: Push Image Upload
  if (config.tests.pushImage.enabled) {
    const success = await runTest(
      'Push Image Upload Test',
      '3-push-image-test.ts',
      [
        `--server-url=${config.serverUrl}`,
        `--background-clients=${config.tests.pushImage.backgroundClientCounts.join(',')}`,
      ]
    );
    results.push({ name: 'Push Image Upload Test', success });
  }

  // Summary
  console.log('\n\n╔═══════════════════════════════════════╗');
  console.log('║   Test Suite Summary                  ║');
  console.log('╚═══════════════════════════════════════╝\n');

  const totalTests = results.length;
  const passedTests = results.filter((r) => r.success).length;
  const failedTests = totalTests - passedTests;

  results.forEach((result) => {
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
  });

  console.log(`\nTotal: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAllTests().catch((error) => {
  console.error('Test suite failed:', error);
  process.exit(1);
});

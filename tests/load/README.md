# Load Testing for ShuGu Server

This directory contains load testing tools to measure the server's capacity and performance under various conditions.

## Quick Start

### 1. Install Dependencies

```bash
cd tests/load
pnpm install
```

### 2. Start Your Server

Make sure your ShuGu server is running and accessible.

### 3. Run Tests

Run individual tests:

```bash
# Test 1: Connection load (find max concurrent client capacity)
pnpm test:connection -- --server-url=https://your-server-url:3001 --max-clients=600

# Test 2: Broadcast latency (measure message delivery latency)
pnpm test:broadcast -- --server-url=https://your-server-url:3001 --clients=50,100,200

# Test 3: Push Image upload (test image upload under load)
pnpm test:push-image -- --server-url=https://your-server-url:3001 --background-clients=100,200
```

Or run all tests at once:

```bash
pnpm test:all -- --server-url=https://your-server-url:3001
```

## Test Descriptions

### Test 1: Connection Load Test

**Purpose**: Determine the maximum number of concurrent client connections the server can handle.

**What it does**:
- Gradually increases client connections (10, 50, 100, 200, 300, ...)
- Measures connection success rate and connection time
- Identifies "comfortable capacity" (95%+ success, <1s connection)
- Identifies "maximum capacity" (50%+ success)

**Results**: JSON file in `test-results/connection-test-*.json`

### Test 2: Broadcast Performance Test

**Purpose**: Measure how quickly broadcast messages reach all clients.

**What it does**:
- Connects N clients (e.g., 50, 100, 200, 500)
- Manager broadcasts various message types
- Measures latency distribution (avg, p50, p95, p99, max)
- Tests small (~0.5KB), medium (~5KB), and large (~100KB) messages

**Results**: JSON file in `test-results/broadcast-test-*.json`

### Test 3: Push Image Upload Test

**Purpose**: Test Push Image Upload feature under high connection load.

**What it does**:
- Connects N background clients (e.g., 100, 200, 300)
- One test client receives Push Image requests from manager
- Measures upload rate, latency, and throughput
- Monitors impact on background client latency

**Results**: JSON file in `test-results/push-image-test-*.json`

## Configuration

You can create a config file for the test suite:

```json
{
  "serverUrl": "https://your-server:3001",
  "tests": {
    "connection": {
      "enabled": true,
      "maxClients": 600
    },
    "broadcast": {
      "enabled": true,
      "clientCounts": [50, 100, 200, 500]
    },
    "pushImage": {
      "enabled": true,
      "backgroundClientCounts": [100, 200, 300]
    }
  }
}
```

Then run: `pnpm test:all -- --config=my-config.json`

## Interpreting Results

### Connection Test

- **Comfortable Capacity**: Safe limit for production use
- **Maximum Capacity**: Absolute limit before failures
- **Recommended Limit**: 80% of comfortable capacity

### Broadcast Test

- **Average Latency < 100ms**: Real-time feel
- **p99 Latency < 500ms**: Acceptable for visual effects
- **Max Latency < 2s**: Prevents noticeable delays

### Push Image Test

- **Upload Rate ≥ 1 fps**: Meets minimum requirement
- **Latency < 1s**: Good responsiveness
- **Background Impact +50ms**: Acceptable overhead

## Tips

1. **Test on production-like environment**: Results vary greatly based on server specs
2. **Test during off-peak hours**: Avoid disrupting real users
3. **Monitor server resources**: Use `htop` or similar to watch CPU/memory
4. **Run tests multiple times**: Network conditions can affect results
5. **SSL certificates**: Ensure your server has valid SSL certs for WSS connections

## Architecture

```
tests/load/
├── shared/
│   ├── client-simulator.ts    # Simulates ShuGu clients
│   ├── metrics-collector.ts   # Collects performance metrics
│   └── test-helpers.ts         # Utility functions
├── 1-connection-test.ts        # Connection load test
├── 2-broadcast-test.ts         # Broadcast latency test
├── 3-push-image-test.ts        # Push Image upload test
├── run-all.ts                  # Test suite runner
└── test-results/               # Output directory (auto-created)
```

## Troubleshooting

**Connection refused**: Make sure server is running and URL is correct

**SSL errors**: If using self-signed certs, you may need to set `NODE_TLS_REJECT_UNAUTHORIZED=0` (not recommended for production)

**Out of memory**: Reduce `maxClients` or client counts in tests

**Timeouts**: Increase connection timeout in `client-simulator.ts` if testing over slow networks

/**
 * Metrics collection and aggregation for load tests
 */

import { percentile } from './test-helpers.js';

export interface ConnectionMetrics {
  attempted: number;
  succeeded: number;
  failed: number;
  successRate: number;
  avgConnectionTime: number;
  minConnectionTime: number;
  maxConnectionTime: number;
}

export interface LatencyMetrics {
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface ThroughputMetrics {
  messagesPerSec: number;
  bytesPerSec: number;
  totalMessages: number;
  totalBytes: number;
}

export class MetricsCollector {
  private connectionTimes: number[] = [];
  private connectionSuccesses = 0;
  private connectionFailures = 0;
  
  private latencies: number[] = [];
  
  private messageCount = 0;
  private byteCount = 0;
  private startTime = 0;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Record a connection attempt
   */
  recordConnection(success: boolean, connectionTimeMs: number): void {
    if (success) {
      this.connectionSuccesses++;
      this.connectionTimes.push(connectionTimeMs);
    } else {
      this.connectionFailures++;
    }
  }

  /**
   * Record a message latency
   */
  recordLatency(latencyMs: number): void {
    this.latencies.push(latencyMs);
  }

  /**
   * Record a message sent/received
   */
  recordMessage(sizeBytes: number): void {
    this.messageCount++;
    this.byteCount += sizeBytes;
  }

  /**
   * Get connection metrics
   */
  getConnectionMetrics(): ConnectionMetrics {
    const total = this.connectionSuccesses + this.connectionFailures;
    const sortedTimes = [...this.connectionTimes].sort((a, b) => a - b);
    
    return {
      attempted: total,
      succeeded: this.connectionSuccesses,
      failed: this.connectionFailures,
      successRate: total > 0 ? (this.connectionSuccesses / total) * 100 : 0,
      avgConnectionTime: sortedTimes.length > 0
        ? sortedTimes.reduce((sum, t) => sum + t, 0) / sortedTimes.length
        : 0,
      minConnectionTime: sortedTimes.length > 0 ? sortedTimes[0] : 0,
      maxConnectionTime: sortedTimes.length > 0 ? sortedTimes[sortedTimes.length - 1] : 0,
    };
  }

  /**
   * Get latency metrics
   */
  getLatencyMetrics(): LatencyMetrics {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    
    if (sorted.length === 0) {
      return { count: 0, avg: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 };
    }
    
    return {
      count: sorted.length,
      avg: sorted.reduce((sum, l) => sum + l, 0) / sorted.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  }

  /**
   * Get throughput metrics
   */
  getThroughputMetrics(): ThroughputMetrics {
    const elapsedSec = (Date.now() - this.startTime) / 1000;
    
    return {
      messagesPerSec: elapsedSec > 0 ? this.messageCount / elapsedSec : 0,
      bytesPerSec: elapsedSec > 0 ? this.byteCount / elapsedSec : 0,
      totalMessages: this.messageCount,
      totalBytes: this.byteCount,
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.connectionTimes = [];
    this.connectionSuccesses = 0;
    this.connectionFailures = 0;
    this.latencies = [];
    this.messageCount = 0;
    this.byteCount = 0;
    this.startTime = Date.now();
  }
}

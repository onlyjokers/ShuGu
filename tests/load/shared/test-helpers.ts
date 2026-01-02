/**
 * Common utilities for load testing
 */

/**
 * Promise-based delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

/**
 * Generate a synthetic base64 DataURL for testing image uploads
 * Creates a simple colored canvas with text
 */
export function generateDataURL(
  format: 'image/jpeg' | 'image/png' | 'image/webp',
  quality: number,
  maxWidth: number
): string {
  // Create a simple pattern - no need for actual canvas/image library in Node.js
  // We'll create a synthetic base64 that approximates realistic image sizes
  
  // Approximate sizes based on format and quality
  const baseSize = maxWidth * (maxWidth * 0.75) * 3; // Rough RGB pixel data
  let estimatedSize: number;
  
  if (format === 'image/jpeg') {
    estimatedSize = Math.floor(baseSize * quality * 0.1); // JPEG compression
  } else if (format === 'image/png') {
    estimatedSize = Math.floor(baseSize * 0.3); // PNG compression
  } else {
    estimatedSize = Math.floor(baseSize * quality * 0.08); // WebP compression
  }
  
  // Generate random base64 data of appropriate size
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64Data = '';
  for (let i = 0; i < estimatedSize / 4 * 3; i++) {
    base64Data += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  
  return `data:${format};base64,${base64Data}`;
}

/**
 * Calculate percentile from sorted array
 */
export function percentile(sortedArray: number[], p: number): number {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((sortedArray.length * p) / 100) - 1;
  return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
}

/**
 * Simple progress bar for CLI
 */
export class ProgressBar {
  private current = 0;
  private lastUpdate = 0;

  constructor(
    private total: number,
    private label: string
  ) {}

  update(current: number): void {
    this.current = current;
    const now = Date.now();
    
    // Throttle updates to every 100ms
    if (now - this.lastUpdate < 100 && current < this.total) return;
    this.lastUpdate = now;
    
    const percent = Math.min(100, (current / this.total) * 100);
    const filled = Math.floor(percent / 2);
    const empty = 50 - filled;
    
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    process.stdout.write(`\r${this.label}: [${bar}] ${percent.toFixed(1)}% (${current}/${this.total})`);
    
    if (current >= this.total) {
      process.stdout.write('\n');
    }
  }

  increment(): void {
    this.update(this.current + 1);
  }

  finish(): void {
    this.update(this.total);
  }
}

/**
 * Gradually establish connections with controlled ramp-up
 */
export async function rampUpConnections<T>(
  count: number,
  intervalMs: number,
  createFn: (index: number) => Promise<T>,
  progressLabel?: string
): Promise<T[]> {
  const results: T[] = [];
  const progress = progressLabel ? new ProgressBar(count, progressLabel) : null;
  
  for (let i = 0; i < count; i++) {
    const result = await createFn(i);
    results.push(result);
    progress?.update(i + 1);
    
    if (i < count - 1) {
      await delay(intervalMs);
    }
  }
  
  return results;
}

/**
 * Generate a unique client ID for testing
 */
export function generateClientId(prefix: string, index: number): string {
  return `${prefix}-${index}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

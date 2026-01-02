/**
 * Client simulator for load testing
 * Mimics behavior of real ShuGu clients
 */

import { io, Socket } from 'socket.io-client';
import type { Message } from '@shugu/protocol';
import { generateClientId, generateDataURL } from './test-helpers.js';

export interface ClientSimulatorOptions {
  serverUrl: string;
  deviceId?: string;
  instanceId?: string;
  clientId?: string;
  group?: string;
  onMessage?: (message: Message) => void;
  onConnect?: (clientId: string) => void;
  onDisconnect?: () => void;
  onError?: (error: Error) => void;
}

export class ClientSimulator {
  private socket: Socket | null = null;
  private registeredClientId: string | null = null;
  private isSelected = false;
  private sensorInterval: NodeJS.Timeout | null = null;
  private pushImageInFlight = false;

  constructor(private options: ClientSimulatorOptions) {}

  /**
   * Connect to the server
   */
  async connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      const deviceId = this.options.deviceId || generateClientId('device', 0);
      const instanceId = this.options.instanceId || generateClientId('instance', 0);
      const clientId = this.options.clientId || generateClientId('client', 0);

      this.socket = io(this.options.serverUrl, {
        query: {
          role: 'client',
          ...(this.options.group && { group: this.options.group }),
        },
        auth: {
          deviceId,
          instanceId,
          clientId,
        },
        transports: ['websocket', 'polling'],
        reconnection: false, // Disable auto-reconnect for testing
      });

      const connectTimeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
        this.socket?.disconnect();
      }, 10000);

      this.socket.on('connect', () => {
        clearTimeout(connectTimeout);
      });

      this.socket.on('msg', (message: Message) => {
        this.handleMessage(message);
        this.options.onMessage?.(message);
      });

      this.socket.on('disconnect', () => {
        this.options.onDisconnect?.();
      });

      this.socket.on('connect_error', (error) => {
        clearTimeout(connectTimeout);
        reject(error);
      });

      // Handle registration confirmation
      const registrationHandler = (message: Message) => {
        if (message.type === 'system' && message.action === 'clientRegistered') {
          const registeredId = message.payload.clientId;
          if (registeredId) {
            this.registeredClientId = registeredId;
            clearTimeout(connectTimeout);
            this.options.onConnect?.(registeredId);
            resolve(registeredId);
          }
        }
      };

      this.socket.on('msg', registrationHandler);
    });
  }

  /**
   * Handle incoming messages
   */
  private handleMessage(message: Message): void {
    if (message.type === 'control') {
      const action = message.action;

      // Handle sensor state control
      if (action === 'setSensorState') {
        const active = (message.payload as any)?.active;
        if (typeof active === 'boolean') {
          this.handleSensorState(active);
        }
      }

      // Handle Push Image Upload request
      if (action === 'custom') {
        const payload = message.payload as any;
        if (payload?.kind === 'push-image-upload') {
          this.handlePushImageUpload(payload);
        }
      }
    }
  }

  /**
   * Handle sensor state change (selected/deselected)
   */
  private handleSensorState(active: boolean): void {
    this.isSelected = active;

    if (active) {
      // Start sending sensor data
      this.startSensorStreaming();
    } else {
      // Stop sending sensor data
      this.stopSensorStreaming();
    }
  }

  /**
   * Start streaming simulated sensor data
   */
  private startSensorStreaming(): void {
    if (this.sensorInterval) return;

    this.sensorInterval = setInterval(() => {
      if (!this.socket || !this.registeredClientId) return;

      // Send simulated gyro data
      this.socket.emit('msg', {
        type: 'data',
        from: 'client',
        clientId: this.registeredClientId,
        sensorType: 'gyro',
        timestamp: Date.now(),
        serverTimestamp: Date.now(),
        version: 1,
        payload: {
          alpha: Math.random() * 360,
          beta: Math.random() * 180 - 90,
          gamma: Math.random() * 180 - 90,
        },
      });
    }, 100); // 10Hz
  }

  /**
   * Stop streaming sensor data
   */
  private stopSensorStreaming(): void {
    if (this.sensorInterval) {
      clearInterval(this.sensorInterval);
      this.sensorInterval = null;
    }
  }

  /**
   * Handle Push Image Upload request
   */
  private async handlePushImageUpload(payload: any): Promise<void> {
    if (this.pushImageInFlight) return;
    this.pushImageInFlight = true;

    try {
      const format = payload.format || 'image/jpeg';
      const quality = payload.quality || 0.85;
      const maxWidth = payload.maxWidth || 960;

      // Generate synthetic DataURL
      const dataUrl = generateDataURL(format, quality, maxWidth);

      // Simulate slight processing delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Send the image back to server
      if (this.socket && this.registeredClientId) {
        this.socket.emit('msg', {
          type: 'data',
          from: 'client',
          clientId: this.registeredClientId,
          sensorType: 'camera',
          timestamp: Date.now(),
          serverTimestamp: Date.now(),
          version: 1,
          payload: {
            dataUrl,
            seq: payload.seq,
          },
        });
      }
    } catch (error) {
      this.options.onError?.(error as Error);
    } finally {
      this.pushImageInFlight = false;
    }
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    this.stopSensorStreaming();
    this.socket?.disconnect();
    this.socket = null;
    this.registeredClientId = null;
  }

  /**
   * Get registered client ID
   */
  getClientId(): string | null {
    return this.registeredClientId;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

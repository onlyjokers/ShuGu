import { get } from 'svelte/store';
import { ManagerSDK } from '@shugu/sdk-manager';
import { getSDK } from '../stores/manager'; // We might need to decouple this later
import { parameterRegistry } from '../parameters/registry';
import { Parameter, normalizePath } from '../parameters/parameter';
import type { ParameterChange } from '../parameters/types';

/**
 * Throttle helper
 */
function throttle<T extends (...args: any[]) => void>(func: T, limit: number): T {
  let inThrottle: boolean;
  return function (this: any, ...args: any[]) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  } as T;
}

export class ManagerClient {
  readonly clientId: string;
  private unsubscribers: (() => void)[] = [];
  
  // Feature flags to start simple (Phase 1 focus)
  private hasFlashlight = true;
  private hasSound = true;
  private hasScreen = true;

  constructor(clientId: string) {
    this.clientId = clientId;
    this.initParameters();
  }

  setOnline(): void {
    parameterRegistry.markOnline(`client/${this.clientId}`);
  }

  setOffline(): void {
    parameterRegistry.markOffline(`client/${this.clientId}`);
  }

  cleanup(): void {
    this.unsubscribers.forEach(u => u());
    this.unsubscribers = [];
  }

  private initParameters(): void {
    // 1. Register Parameters
    this.registerFlashlight();
    this.registerSound();
    this.registerScreen();

    // 2. Read-First Sync (TODO: If API supported 'getClientState', we'd call it here)
    // For now, we trust the defaults or any existing values in Registry if it was a reconnect.
  }

  // --- Flashlight Feature ---
  private registerFlashlight(): void {
    const base = `client/${this.clientId}/flashlight`;

    // Brightness (simulated by toggle for now, but good example)
    const pEnabled = parameterRegistry.register<boolean>({
      path: `${base}/enabled`,
      type: 'boolean',
      defaultValue: false,
      metadata: { label: 'Flashlight', widgetType: 'toggle', group: 'Flashlight' }
    });

    const pStrobe = parameterRegistry.register<number>({
      path: `${base}/strobe`,
      type: 'number',
      defaultValue: 0,
      min: 0, 
      max: 20,
      metadata: { label: 'Strobe Hz', widgetType: 'slider', unit: 'Hz', group: 'Flashlight' }
    });

    // Upstream (App -> Device)
    this.bindOutput(pEnabled, (val) => {
        const sdk = getSDK();
        // Simple mapping: Toggle flashlight
        if (val) sdk?.flashlight('on', {}, false, 0); // TODO: specific client targeting
        else sdk?.flashlight('off', {}, false, 0);
    });
    
    // For strobe, we might throttle
    this.bindOutput(pStrobe, throttle((val) => {
        const sdk = getSDK();
        // If val > 0, set strobe mode
        if (val > 0) sdk?.flashlight('blink', { frequency: val }, false, 0); // TODO: targeting
        else if (pEnabled.effectiveValue) sdk?.flashlight('on', {}, false, 0);
        else sdk?.flashlight('off', {}, false, 0);
    }, 50)); // 50ms throttle
  }

  // --- Sound Feature ---
  private registerSound(): void {
      const base = `client/${this.clientId}/sound`;
      
      const pVol = parameterRegistry.register<number>({
          path: `${base}/volume`,
          type: 'number',
          defaultValue: 1.0,
          min: 0, max: 1,
          metadata: { label: 'Volume', widgetType: 'slider', group: 'Sound' }
      });

      const pFreq = parameterRegistry.register<number>({
          path: `${base}/frequency`,
          type: 'number',
          defaultValue: 440,
          min: 50, max: 2000,
          metadata: { label: 'Frequency', widgetType: 'slider', unit: 'Hz', group: 'Sound' }
      });
      
      this.bindOutput(pVol, throttle((val) => {
          getSDK()?.modulateSoundUpdate({ volume: val }, false); // TODO: targeting
      }, 30));

      this.bindOutput(pFreq, throttle((val) => {
          getSDK()?.modulateSoundUpdate({ frequency: val }, false); // TODO: targeting
      }, 30));
  }

  // --- Screen Feature ---
  private registerScreen(): void {
       const base = `client/${this.clientId}/screen`;
       
       const pColor = parameterRegistry.register<string>({
           path: `${base}/color`,
           type: 'string', // 'color' type not fully supported in simple factory yet, using string
           defaultValue: '#000000',
           metadata: { label: 'Background', widgetType: 'color', group: 'Screen' }
       });
       
       this.bindOutput(pColor, throttle((val) => {
           // SDK expects ScreenColorPayload object, not just string
           getSDK()?.screenColor({ color: val, opacity: 1, mode: 'solid' }, false); // TODO: targeting
       }, 50));
  }


  // --- Core Binding Logic ---
  
  /**
   * Binds a Parameter to an output action (sending to SDK).
   * Implements Loop Prevention and Throttling (via wrapper).
   */
  private bindOutput<T>(param: Parameter<T>, action: (val: T) => void): void {
      const unsub = param.addListener((val, change) => {
          // LOOP PREVENTION: If source is DEVICE, do not send back to device
          if (change.source === 'DEVICE') return;
          
          action(val);
      });
      this.unsubscribers.push(unsub);
  }
}

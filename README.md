# ShuGu - Interactive Art Performance System

A Web-based multi-device real-time interactive system for live performances, consisting of:

- **Manager**: Desktop control panel for performers
- **Client**: Mobile web app for audience interaction
- **Server**: Node.js WebSocket server for message routing

## Features

- 🎨 Real-time synchronized visual effects (Three.js)
- 🔊 Audio analysis with mel spectrogram and beat detection
- 📱 Mobile sensor data (gyroscope, accelerometer, orientation)
- 💡 Flashlight control (hardware + fallback)
- 📳 Vibration patterns
- 🎵 Synchronized audio playback
- ⏱️ NTP-style time synchronization for coordinated actions

## Project Structure

```
shugu3/
├── apps/
│   ├── manager/        # SvelteKit desktop control panel
│   ├── client/         # SvelteKit mobile experience
│   └── server/         # NestJS + Socket.io server
├── packages/
│   ├── protocol/       # Shared TypeScript types & utilities
│   ├── sdk-client/     # Client-side SDK
│   ├── sdk-manager/    # Manager-side SDK
│   ├── audio-plugins/  # Mel spectrogram, audio split plugins
│   ├── visual-plugins/ # Three.js scene plugins
│   └── ui-kit/         # Shared UI components & styles
```

## Quick Start

### Prerequisites

- Node.js >= 18
- pnpm >= 8

### Installation

```bash
# Install dependencies
pnpm install

# Build packages
pnpm run build:all
```

### Development

```bash
# Start all apps in development mode
pnpm run dev:all

# Or start individually:
pnpm run dev:server   # Server on https://localhost:3001 (requires secrets/cert.pem + secrets/key.pem)
pnpm run dev:manager  # Manager on https://localhost:5173 (self-signed via Vite basicSsl)
pnpm run dev:client   # Client on https://localhost:5174 (self-signed via Vite basicSsl)
```

### Testing

1. Open Manager in desktop browser: `https://localhost:5173`
2. Connect to server (default: `https://localhost:3001`)
3. Open Client on mobile device: `https://<your-ip>:5174`
4. Click "进入体验 / Start Experience" on mobile
5. Approve permission requests
6. Select connected clients in Manager and send control commands

## Node Executor (client-side loops)

Manager Node Graph can detect a self-loop that includes `Client` + `Client Sensors` and deploy that subgraph to the
client to run locally (reduces bandwidth and manager CPU).

- Protocol: `PluginControlMessage` (`pluginId: node-executor`, `command: deploy/start/stop/remove`)
- Safety: capability gating + whitelist + resource limits on the client
- Monitoring: client reports `node-executor` status/logs back to manager

See `docs/node-executor.md` and run the E2E harness with `pnpm e2e:node-executor`.

## Mobile Browser Compatibility

### Tested Browsers

- ✅ WeChat in-app browser (Android/iOS)
- ✅ Safari (iOS 13+)
- ✅ Chrome (Android)

### Feature Fallbacks

| Feature        | Primary                  | Fallback                 |
| -------------- | ------------------------ | ------------------------ |
| Flashlight     | Camera torch API         | White screen             |
| Vibration      | navigator.vibrate()      | Silent fail              |
| Wake Lock      | Screen Wake Lock API     | User must keep screen on |
| Motion sensors | DeviceMotion/Orientation | Disabled                 |

> **Note**: iOS 13+ requires explicit permission for motion sensors. The permission request must be triggered by a user gesture.

## Protocol

All messages are transmitted via Socket.io `msg` event with the following types:

- `ControlMessage`: Manager → Clients (flashlight, vibrate, screen color, etc.)
- `SensorDataMessage`: Clients → Manager (gyro, accel, mic data)
- `MediaMetaMessage`: Synchronized audio/video playback
- `PluginControlMessage`: Audio/visual plugin control
- `SystemMessage`: Connection management

### Time Synchronization

The system uses NTP-style time sync:

1. Client sends `time:ping` with local timestamp
2. Server replies `time:pong` with server timestamp
3. Client calculates RTT and offset
4. Actions can be scheduled using `executeAt` field for synchronized execution

## Extending the System

### Adding a New Audio Plugin

```typescript
import type { AudioPlugin } from '@shugu/audio-plugins';

export class MyPlugin implements AudioPlugin {
  id = 'my-plugin';

  async init(ctx: AudioContext, source: AudioNode) {
    // Setup audio processing
  }

  start() {
    /* Begin analysis */
  }
  stop() {
    /* Stop analysis */
  }

  onFeature(cb: (feature: any) => void) {
    // Register callback for feature output
  }
}
```

### Adding a New Visual Scene

```typescript
import type { VisualScene } from '@shugu/visual-plugins';

export class MyScene implements VisualScene {
  id = 'my-scene';

  mount(container: HTMLElement) {
    // Create Three.js scene
  }

  unmount() {
    // Cleanup
  }

  update(dt: number, context: VisualContext) {
    // Update scene with sensor/audio data
  }
}
```

## Performance Considerations

- Client renders at device refresh rate with automatic FPS limiting
- Sensor data throttled to 10Hz by default
- Audio analysis runs at 30Hz
- Only selected clients send high-frequency data
- Three.js canvas resolution scaled for mobile

## Known Limitations

1. **WeChat Browser**: Some web APIs may be restricted
2. **iOS Safari**: Requires user gesture for audio/motion permissions
3. **Camera Torch**: Not supported on all devices
4. **Vibration**: iOS Safari doesn't support navigator.vibrate()

## License

ISC

## Author

Built for interactive art performances

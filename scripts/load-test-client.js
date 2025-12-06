import { io } from 'socket.io-client';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Parse args
const args = process.argv.slice(2);
const countArg = args.find(a => a.startsWith('--count='));
const CLIENT_COUNT = countArg ? parseInt(countArg.split('=')[1]) : 10;
const SERVER_URL = 'https://localhost:3001';

console.log(`Starting load test with ${CLIENT_COUNT} clients connecting to ${SERVER_URL}`);

const clients = [];

for (let i = 0; i < CLIENT_COUNT; i++) {
    const socket = io(SERVER_URL, {
        query: { role: 'client' },
        transports: ['websocket'],
        forceNew: true,
        rejectUnauthorized: false // Allow self-signed certs
    });

    socket.on('connect', () => {
        console.log(`[Client ${i}] Connected`);
    });

    socket.on('msg', (data) => {
        if (data.type === 'control' && data.action === 'setSensorState') {
            const active = data.payload.active;
            console.log(`[Client ${i}] Sensor state changed: ${active ? 'ACTIVE' : 'IDLE'}`);
            
            if (active) {
                // Start sending data if activated
                startSendingData(socket, i);
            } else {
                stopSendingData(i);
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`[Client ${i}] Disconnected`);
        stopSendingData(i);
    });

    clients.push({ socket, interval: null });
}

function startSendingData(socket, index) {
    if (clients[index].interval) return;

    console.log(`[Client ${index}] Starting data stream`);
    clients[index].interval = setInterval(() => {
        const payload = {
            type: 'data',
            from: 'client',
            clientId: `load_test_${index}`,
            sensorType: 'orientation',
            version: 1,
            serverTimestamp: 0, // Mock
            payload: {
                alpha: Math.random() * 360,
                beta: Math.random() * 180 - 90,
                gamma: Math.random() * 90 - 45,
                absolute: false
            }
        };
        socket.emit('msg', payload);
    }, 100); // 10Hz
}

function stopSendingData(index) {
    if (clients[index].interval) {
        console.log(`[Client ${index}] Stopping data stream`);
        clearInterval(clients[index].interval);
        clients[index].interval = null;
    }
}

// Keep alive
process.stdin.resume();

process.on('SIGINT', () => {
    console.log('Stopping load test...');
    clients.forEach((c, i) => {
        stopSendingData(i);
        c.socket.disconnect();
    });
    process.exit();
});

import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnGatewayInit,
    MessageBody,
    ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient, type RedisClientType } from 'redis';
import { ClientRegistryService } from '../client-registry/client-registry.service.js';
import { MessageRouterService } from '../message-router/message-router.service.js';
import type { Message, ConnectionRole, TimePingData } from '@shugu/protocol';
import { createTimePong, isValidMessage } from '@shugu/protocol';

function sanitizeGroup(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const limited = trimmed.slice(0, 80);
    const sanitized = limited.replace(/[^a-zA-Z0-9_-]/g, '_');
    return sanitized || null;
}

@WebSocketGateway({
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
    // Image pipeline uses DataURL payloads which can exceed Socket.IO's 1MB default.
    // Keep this reasonably high so Push Image Upload -> Display can stream screenshots.
    maxHttpBufferSize: 20 * 1024 * 1024,
})
export class EventsGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    private pubClient: RedisClientType | null = null;
    private subClient: RedisClientType | null = null;

    constructor(
        private readonly clientRegistry: ClientRegistryService,
        private readonly messageRouter: MessageRouterService,
    ) { }

    async afterInit(server: Server) {
        console.log('[Gateway] WebSocket server initialized');

        // Try to connect to Redis for better broadcast performance
        // Set DISABLE_REDIS_ADAPTER=1 to compare performance with/without Redis
        const redisUrl = process.env.REDIS_URL;
        const disableRedis = process.env.DISABLE_REDIS_ADAPTER === '1';
        
        if (disableRedis) {
            console.log('[Gateway] Redis adapter disabled via DISABLE_REDIS_ADAPTER=1');
        } else if (redisUrl) {
            try {
                console.log('[Gateway] Connecting to Redis adapter...');
                
                this.pubClient = createClient({ url: redisUrl }) as RedisClientType;
                this.subClient = this.pubClient.duplicate() as RedisClientType;

                // Handle Redis errors gracefully
                this.pubClient.on('error', (err) => {
                    console.error('[Redis] Pub client error:', err.message);
                });
                this.subClient.on('error', (err) => {
                    console.error('[Redis] Sub client error:', err.message);
                });

                await Promise.all([
                    this.pubClient.connect(),
                    this.subClient.connect(),
                ]);

                server.adapter(createAdapter(this.pubClient, this.subClient));
                console.log('[Gateway] ✅ Redis adapter enabled - broadcasts optimized');
            } catch (err) {
                console.warn('[Gateway] ⚠️ Redis adapter failed, using default adapter:', (err as Error).message);
                // Continue with default adapter
            }
        } else {
            console.log('[Gateway] Redis not configured (set REDIS_URL to enable)');
        }

        this.messageRouter.setServer(server);
    }

    handleConnection(client: Socket) {
        // Get role from query params
        const role = (client.handshake.query.role as ConnectionRole) || 'client';
        const group = sanitizeGroup(client.handshake.query.group);
        const userAgent = client.handshake.headers['user-agent'];
        const auth = client.handshake.auth as Record<string, unknown> | undefined;

        console.log(`[Gateway] Connection: ${client.id} as ${role}`);

        // Register the connection
        const { clientId, replacedSocketId } = this.clientRegistry.registerConnection(
            client.id,
            role,
            userAgent,
            {
                deviceId: typeof auth?.deviceId === 'string' ? auth.deviceId : undefined,
                instanceId: typeof auth?.instanceId === 'string' ? auth.instanceId : undefined,
                clientId: typeof auth?.clientId === 'string' ? auth.clientId : undefined,
            }
        );

        if (role === 'client' && group) {
            this.clientRegistry.setClientGroup(clientId, group);
        }

        if (replacedSocketId) {
            const oldSocket = this.server.sockets.sockets.get(replacedSocketId);
            oldSocket?.disconnect(true);
        }

        // Send registration confirmation
        this.messageRouter.sendRegistrationConfirmation(client.id, clientId);

        // Notify managers if a client joined
        if (role === 'client') {
            this.messageRouter.notifyClientJoined(clientId);
            
            // Default to inactive sensors
            client.emit('msg', {
                type: 'control',
                id: `ctrl_${Date.now()}`,
                timestamp: Date.now(),
                source: 'server',
                target: { mode: 'clientIds', ids: [clientId] },
                action: 'setSensorState',
                payload: { active: false }
            });
        } else if (role === 'manager') {
            // Send current client list to new manager
            this.messageRouter.broadcastClientListUpdate();
        }
    }

    handleDisconnect(client: Socket) {
        console.log(`[Gateway] Disconnection: ${client.id}`);

        const connectionInfo = this.clientRegistry.unregisterBySocketId(client.id);

        if (connectionInfo && connectionInfo.role === 'client') {
            this.messageRouter.notifyClientLeft(connectionInfo.clientId);
        }
    }

    /**
     * Handle main message event
     */
    @SubscribeMessage('msg')
    handleMessage(
        @MessageBody() message: Message,
        @ConnectedSocket() client: Socket,
    ): void {
        // Validate message structure
        if (!isValidMessage(message)) {
            console.warn(`[Gateway] Invalid message from ${client.id}:`, message);
            return;
        }

        // Check authorization for control messages
        if (message.type === 'control' || message.type === 'media' || message.type === 'plugin') {
            if (!this.clientRegistry.isManager(client.id)) {
                console.warn(`[Gateway] Unauthorized control message from ${client.id}`);
                return;
            }
        }

        // Route the message
        this.messageRouter.routeMessage(message, client.id);
    }

    /**
     * Handle time synchronization ping
     */
    @SubscribeMessage('time:ping')
    handleTimePing(
        @MessageBody() data: TimePingData,
        @ConnectedSocket() client: Socket,
    ): void {
        const pongData = createTimePong(data);
        client.emit('time:pong', pongData);
    }

    /**
     * Handle client selection update from manager
     */
    @SubscribeMessage('select:clients')
    handleSelectClients(
        @MessageBody() data: { clientIds: string[] },
        @ConnectedSocket() client: Socket,
    ): void {
        if (!this.clientRegistry.isManager(client.id)) {
            return;
        }

        // Update selection state
        // Calculate changes
        const allClients = this.clientRegistry.getAllClients();
        const previousSelection = new Set(
            allClients.filter(c => c.selected).map(c => c.clientId)
        );
        const newSelection = new Set(data.clientIds);

        const newlySelected = data.clientIds.filter(id => !previousSelection.has(id));
        const newlyDeselected = Array.from(previousSelection).filter(id => !newSelection.has(id));

        // Update registry state
        allClients.forEach(c => {
            this.clientRegistry.setClientSelected(
                c.clientId,
                data.clientIds.includes(c.clientId)
            );
        });

        // Notify newly selected clients to START streaming
        if (newlySelected.length > 0) {
            const socketIds = this.clientRegistry.getSocketIds(newlySelected);
            socketIds.forEach(socketId => {
                this.server.to(socketId).emit('msg', {
                    type: 'control',
                    id: `ctrl_${Date.now()}`,
                    timestamp: Date.now(),
                    source: 'server',
                    target: { mode: 'clientIds', ids: [this.clientRegistry.getClientIdBySocketId(socketId)!] },
                    action: 'setSensorState',
                    payload: { active: true }
                });
            });
        }

        // Notify newly deselected clients to STOP streaming
        if (newlyDeselected.length > 0) {
            const socketIds = this.clientRegistry.getSocketIds(newlyDeselected);
            socketIds.forEach(socketId => {
                this.server.to(socketId).emit('msg', {
                    type: 'control',
                    id: `ctrl_${Date.now()}`,
                    timestamp: Date.now(),
                    source: 'server',
                    target: { mode: 'clientIds', ids: [this.clientRegistry.getClientIdBySocketId(socketId)!] },
                    action: 'setSensorState',
                    payload: { active: false }
                });
            });
        }

        // Broadcast updated client list
        this.messageRouter.broadcastClientListUpdate();
    }
}

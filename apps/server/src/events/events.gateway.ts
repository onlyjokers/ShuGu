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
import { ClientRegistryService } from '../client-registry/client-registry.service.js';
import { MessageRouterService } from '../message-router/message-router.service.js';
import type { Message, ConnectionRole, TimePingData } from '@shugu/protocol';
import { createTimePong, isValidMessage } from '@shugu/protocol';

@WebSocketGateway({
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
})
export class EventsGateway
    implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer()
    server!: Server;

    constructor(
        private readonly clientRegistry: ClientRegistryService,
        private readonly messageRouter: MessageRouterService,
    ) { }

    afterInit(server: Server) {
        console.log('[Gateway] WebSocket server initialized');
        this.messageRouter.setServer(server);
    }

    handleConnection(client: Socket) {
        // Get role from query params
        const role = (client.handshake.query.role as ConnectionRole) || 'client';
        const userAgent = client.handshake.headers['user-agent'];

        console.log(`[Gateway] Connection: ${client.id} as ${role}`);

        // Register the connection
        const clientId = this.clientRegistry.registerConnection(
            client.id,
            role,
            userAgent
        );

        // Send registration confirmation
        this.messageRouter.sendRegistrationConfirmation(client.id, clientId);

        // Notify managers if a client joined
        if (role === 'client') {
            this.messageRouter.notifyClientJoined(clientId);
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
        const allClients = this.clientRegistry.getAllClients();
        allClients.forEach(c => {
            this.clientRegistry.setClientSelected(
                c.clientId,
                data.clientIds.includes(c.clientId)
            );
        });

        // Broadcast updated client list
        this.messageRouter.broadcastClientListUpdate();
    }
}

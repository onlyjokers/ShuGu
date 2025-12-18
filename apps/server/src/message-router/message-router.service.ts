import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { ClientRegistryService } from '../client-registry/client-registry.service.js';
import type {
    Message,
    ControlMessage,
    SensorDataMessage,
    MediaMetaMessage,
    PluginControlMessage,
    SystemMessage,
    TargetSelector,
    SOCKET_EVENTS,
} from '@shugu/protocol';
import { addServerTimestamp } from '@shugu/protocol';

@Injectable()
export class MessageRouterService {
    private server: Server | null = null;

    constructor(private readonly clientRegistry: ClientRegistryService) { }

    /**
     * Set Socket.io server instance
     */
    setServer(server: Server): void {
        this.server = server;
    }

    /**
     * Route a message based on its type and target
     */
    routeMessage(message: Message, fromSocketId: string): void {
        if (!this.server) {
            console.error('[Router] Server not initialized');
            return;
        }

        // Add server timestamp to all messages
        const timestampedMessage = addServerTimestamp(message, Date.now());

        switch (message.type) {
            case 'control':
                this.routeControlMessage(timestampedMessage as ControlMessage);
                break;
            case 'data':
                this.routeSensorDataMessage(timestampedMessage as SensorDataMessage);
                break;
            case 'media':
                this.routeMediaMessage(timestampedMessage as MediaMetaMessage);
                break;
            case 'plugin':
                this.routePluginMessage(timestampedMessage as PluginControlMessage);
                break;
            case 'system':
                this.routeSystemMessage(timestampedMessage as SystemMessage, fromSocketId);
                break;
        }
    }

    /**
     * Route control message from manager to clients
     */
    private routeControlMessage(message: ControlMessage): void {
        const socketIds = this.resolveTargetSocketIds(message.target, 'client');
        console.log(`[Router] Control message "${message.action}" -> ${socketIds.length} clients`);

        socketIds.forEach(socketId => {
            this.server!.to(socketId).emit('msg', message);
        });
    }

    /**
     * Route sensor data from client to managers
     * Only send detailed data from selected clients
     */
    private routeSensorDataMessage(message: SensorDataMessage): void {
        const managerSocketIds = this.clientRegistry.getAllManagerSocketIds();

        // Forward to all managers
        managerSocketIds.forEach(socketId => {
            this.server!.to(socketId).emit('msg', message);
        });
    }

    /**
     * Route media message from manager to clients
     */
    private routeMediaMessage(message: MediaMetaMessage): void {
        const socketIds = this.resolveTargetSocketIds(message.target, 'client');
        console.log(`[Router] Media message -> ${socketIds.length} clients`);

        socketIds.forEach(socketId => {
            this.server!.to(socketId).emit('msg', message);
        });
    }

    /**
     * Route plugin control message from manager to clients
     */
    private routePluginMessage(message: PluginControlMessage): void {
        const socketIds = this.resolveTargetSocketIds(message.target, 'client');
        console.log(`[Router] Plugin message "${message.pluginId}:${message.command}" -> ${socketIds.length} clients`);

        socketIds.forEach(socketId => {
            this.server!.to(socketId).emit('msg', message);
        });
    }

    /**
     * Route system message
     */
    private routeSystemMessage(message: SystemMessage, fromSocketId: string): void {
        // System messages are typically handled by the gateway directly
        console.log(`[Router] System message: ${message.action}`);
    }

    /**
     * Resolve target selector to socket IDs
     */
    private resolveTargetSocketIds(target: TargetSelector, roleFilter: 'client' | 'manager'): string[] {
        switch (target.mode) {
            case 'all':
                return roleFilter === 'client'
                    ? this.clientRegistry.getAllClientSocketIds()
                    : this.clientRegistry.getAllManagerSocketIds();

            case 'clientIds':
                return this.clientRegistry.getSocketIds(target.ids);

            case 'group': {
                const clients = this.clientRegistry.getClientsByGroup(target.groupId);
                return clients.map(c => c.socketId);
            }

            default:
                return [];
        }
    }

    /**
     * Broadcast client list update to all managers
     */
    broadcastClientListUpdate(): void {
        if (!this.server) return;

        const clients = this.clientRegistry.getAllClients();
        const managerSocketIds = this.clientRegistry.getAllManagerSocketIds();

        const message: SystemMessage = addServerTimestamp({
            type: 'system',
            version: 1,
            action: 'clientList',
            payload: { clients },
        }, Date.now());

        managerSocketIds.forEach(socketId => {
            this.server!.to(socketId).emit('msg', message);
        });
    }

    /**
     * Notify managers of client join
     */
    notifyClientJoined(clientId: string): void {
        if (!this.server) return;

        const managerSocketIds = this.clientRegistry.getAllManagerSocketIds();
        const message: SystemMessage = addServerTimestamp({
            type: 'system',
            version: 1,
            action: 'clientJoined',
            payload: { clientId },
        }, Date.now());

        managerSocketIds.forEach(socketId => {
            this.server!.to(socketId).emit('msg', message);
        });

        // Also send full client list
        this.broadcastClientListUpdate();
    }

    /**
     * Notify managers of client leave
     */
    notifyClientLeft(clientId: string): void {
        if (!this.server) return;

        const managerSocketIds = this.clientRegistry.getAllManagerSocketIds();
        const message: SystemMessage = addServerTimestamp({
            type: 'system',
            version: 1,
            action: 'clientLeft',
            payload: { clientId },
        }, Date.now());

        managerSocketIds.forEach(socketId => {
            this.server!.to(socketId).emit('msg', message);
        });

        // Also send full client list
        this.broadcastClientListUpdate();
    }

    /**
     * Send registration confirmation to a client
     */
    sendRegistrationConfirmation(socketId: string, clientId: string): void {
        if (!this.server) return;

        const message: SystemMessage = addServerTimestamp({
            type: 'system',
            version: 1,
            action: 'clientRegistered',
            payload: { clientId },
        }, Date.now());

        this.server.to(socketId).emit('msg', message);
    }
}

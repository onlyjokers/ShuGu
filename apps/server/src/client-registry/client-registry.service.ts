import { Injectable } from '@nestjs/common';
import type { ClientInfo, ConnectionRole } from '@shugu/protocol';

interface ConnectionInfo {
    socketId: string;
    clientId: string;
    role: ConnectionRole;
    connectedAt: number;
    userAgent?: string;
    group?: string;
    selected: boolean;
}

@Injectable()
export class ClientRegistryService {
    private clients: Map<string, ConnectionInfo> = new Map();
    private managers: Map<string, ConnectionInfo> = new Map();
    private socketToClientId: Map<string, string> = new Map();
    private clientIdCounter = 0;

    /**
     * Generate unique client ID
     */
    private generateClientId(): string {
        this.clientIdCounter++;
        const timestamp = Date.now().toString(36);
        const counter = this.clientIdCounter.toString(36).padStart(4, '0');
        return `c_${timestamp}_${counter}`;
    }

    /**
     * Generate manager ID
     */
    private generateManagerId(): string {
        const timestamp = Date.now().toString(36);
        return `m_${timestamp}`;
    }

    /**
     * Register a new connection
     */
    registerConnection(
        socketId: string,
        role: ConnectionRole,
        userAgent?: string
    ): string {
        const clientId = role === 'client'
            ? this.generateClientId()
            : this.generateManagerId();

        const info: ConnectionInfo = {
            socketId,
            clientId,
            role,
            connectedAt: Date.now(),
            userAgent,
            selected: false,
        };

        if (role === 'client') {
            this.clients.set(clientId, info);
        } else {
            this.managers.set(clientId, info);
        }

        this.socketToClientId.set(socketId, clientId);

        console.log(`[Registry] ${role} registered: ${clientId} (socket: ${socketId})`);
        return clientId;
    }

    /**
     * Unregister a connection by socket ID
     */
    unregisterBySocketId(socketId: string): ConnectionInfo | null {
        const clientId = this.socketToClientId.get(socketId);
        if (!clientId) return null;

        this.socketToClientId.delete(socketId);

        const clientInfo = this.clients.get(clientId);
        if (clientInfo) {
            this.clients.delete(clientId);
            console.log(`[Registry] client disconnected: ${clientId}`);
            return clientInfo;
        }

        const managerInfo = this.managers.get(clientId);
        if (managerInfo) {
            this.managers.delete(clientId);
            console.log(`[Registry] manager disconnected: ${clientId}`);
            return managerInfo;
        }

        return null;
    }

    /**
     * Get client info by client ID
     */
    getClient(clientId: string): ConnectionInfo | undefined {
        return this.clients.get(clientId);
    }

    /**
     * Get socket ID by client ID
     */
    getSocketId(clientId: string): string | undefined {
        return this.clients.get(clientId)?.socketId || this.managers.get(clientId)?.socketId;
    }

    /**
     * Get client ID by socket ID
     */
    getClientIdBySocketId(socketId: string): string | undefined {
        return this.socketToClientId.get(socketId);
    }

    /**
     * Check if socket is a manager
     */
    isManager(socketId: string): boolean {
        const clientId = this.socketToClientId.get(socketId);
        if (!clientId) return false;
        return this.managers.has(clientId);
    }

    /**
     * Get all connections for a list of client IDs
     */
    getSocketIds(clientIds: string[]): string[] {
        return clientIds
            .map(id => this.getSocketId(id))
            .filter((id): id is string => id !== undefined);
    }

    /**
     * Get all client socket IDs
     */
    getAllClientSocketIds(): string[] {
        return Array.from(this.clients.values()).map(c => c.socketId);
    }

    /**
     * Get all manager socket IDs
     */
    getAllManagerSocketIds(): string[] {
        return Array.from(this.managers.values()).map(m => m.socketId);
    }

    /**
     * Get all clients as ClientInfo array
     */
    getAllClients(): ClientInfo[] {
        return Array.from(this.clients.values()).map(c => ({
            clientId: c.clientId,
            connectedAt: c.connectedAt,
            userAgent: c.userAgent,
            group: c.group,
            selected: c.selected,
        }));
    }

    /**
     * Get all managers
     */
    getAllManagers(): { clientId: string; connectedAt: number }[] {
        return Array.from(this.managers.values()).map(m => ({
            clientId: m.clientId,
            connectedAt: m.connectedAt,
        }));
    }

    /**
     * Get client count
     */
    getClientCount(): number {
        return this.clients.size;
    }

    /**
     * Get manager count
     */
    getManagerCount(): number {
        return this.managers.size;
    }

    /**
     * Set client group
     */
    setClientGroup(clientId: string, group: string): void {
        const client = this.clients.get(clientId);
        if (client) {
            client.group = group;
        }
    }

    /**
     * Set client selected state
     */
    setClientSelected(clientId: string, selected: boolean): void {
        const client = this.clients.get(clientId);
        if (client) {
            client.selected = selected;
        }
    }

    /**
     * Get clients by group
     */
    getClientsByGroup(groupId: string): ConnectionInfo[] {
        return Array.from(this.clients.values()).filter(c => c.group === groupId);
    }

    /**
     * Get selected clients
     */
    getSelectedClients(): ConnectionInfo[] {
        return Array.from(this.clients.values()).filter(c => c.selected);
    }
}

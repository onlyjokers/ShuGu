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
    deviceId?: string;
    instanceId?: string;
}

type ClientIdentity = {
    deviceId?: string;
    instanceId?: string;
    clientId?: string;
};

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
        userAgent?: string,
        identity?: ClientIdentity,
    ): { clientId: string; replacedSocketId?: string } {
        const now = Date.now();
        let replacedSocketId: string | undefined;

        if (role === 'client') {
            const deviceId = this.sanitizeId(identity?.deviceId);
            const instanceId = this.sanitizeId(identity?.instanceId);
            const requestedClientId = this.sanitizeId(identity?.clientId);

            if (deviceId) {
                const desiredClientId = requestedClientId ?? deviceId;
                const existing = this.clients.get(desiredClientId);

                if (existing) {
                    // Same tab/session: take over the existing stable clientId to avoid duplicates.
                    if (instanceId && existing.instanceId === instanceId) {
                        replacedSocketId = existing.socketId !== socketId ? existing.socketId : undefined;
                        if (replacedSocketId) {
                            this.socketToClientId.delete(replacedSocketId);
                        }

                        existing.socketId = socketId;
                        existing.connectedAt = now;
                        existing.userAgent = userAgent;
                        existing.deviceId = deviceId;
                        existing.instanceId = instanceId;

                        this.socketToClientId.set(socketId, desiredClientId);

                        console.log(`[Registry] client reconnected: ${desiredClientId} (socket: ${socketId})`);
                        return { clientId: desiredClientId, replacedSocketId };
                    }

                    // Another tab/device tries to use the same desired id: allocate a new suffix.
                    const allocated = this.allocateClientId(deviceId);
                    const info: ConnectionInfo = {
                        socketId,
                        clientId: allocated,
                        role,
                        connectedAt: now,
                        userAgent,
                        selected: false,
                        deviceId,
                        instanceId: instanceId ?? undefined,
                    };
                    this.clients.set(allocated, info);
                    this.socketToClientId.set(socketId, allocated);
                    console.log(`[Registry] client registered: ${allocated} (socket: ${socketId})`);
                    return { clientId: allocated };
                }

                // Desired id is free, use it as-is.
                const info: ConnectionInfo = {
                    socketId,
                    clientId: desiredClientId,
                    role,
                    connectedAt: now,
                    userAgent,
                    selected: false,
                    deviceId,
                    instanceId: instanceId ?? undefined,
                };
                this.clients.set(desiredClientId, info);
                this.socketToClientId.set(socketId, desiredClientId);
                console.log(`[Registry] client registered: ${desiredClientId} (socket: ${socketId})`);
                return { clientId: desiredClientId };
            }

            // No usable identity provided; fall back to generated id.
            const clientId = this.generateClientId();
            const info: ConnectionInfo = {
                socketId,
                clientId,
                role,
                connectedAt: now,
                userAgent,
                selected: false,
            };
            this.clients.set(clientId, info);
            this.socketToClientId.set(socketId, clientId);
            console.log(`[Registry] client registered: ${clientId} (socket: ${socketId})`);
            return { clientId };
        }

        // Managers: keep existing behavior (server-generated ids).
        const managerId = this.generateManagerId();
        const managerInfo: ConnectionInfo = {
            socketId,
            clientId: managerId,
            role,
            connectedAt: now,
            userAgent,
            selected: false,
        };
        this.managers.set(managerId, managerInfo);
        this.socketToClientId.set(socketId, managerId);

        console.log(`[Registry] ${role} registered: ${managerId} (socket: ${socketId})`);
        return { clientId: managerId };
    }

    private sanitizeId(value: unknown): string | null {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        if (!trimmed) return null;
        const limited = trimmed.slice(0, 80);
        const sanitized = limited.replace(/[^a-zA-Z0-9_-]/g, '_');
        return sanitized || null;
    }

    private allocateClientId(baseId: string): string {
        if (!this.isClientIdInUse(baseId)) return baseId;
        for (let suffix = 1; suffix < 10_000; suffix++) {
            const candidate = `${baseId}_${suffix}`;
            if (!this.isClientIdInUse(candidate)) return candidate;
        }
        // Last resort: fall back to a generated ID.
        return this.generateClientId();
    }

    private isClientIdInUse(clientId: string): boolean {
        return this.clients.has(clientId) || this.managers.has(clientId);
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

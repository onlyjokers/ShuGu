/**
 * Time synchronization utilities
 * Implements NTP-style time synchronization for coordinated actions
 */

export interface TimeSyncResult {
    /** Round-trip time in milliseconds */
    rtt: number;
    /** Offset between local and server time (local + offset = server) */
    offset: number;
    /** Server timestamp from the response */
    serverTimestamp: number;
}

export interface TimeSyncState {
    /** Current calculated offset (moving average) */
    offset: number;
    /** Array of recent offset samples for averaging */
    samples: number[];
    /** Maximum number of samples to keep */
    maxSamples: number;
    /** Is sync initialized */
    initialized: boolean;
    /** Last sync time */
    lastSyncTime: number;
}

/**
 * Calculate time sync result from ping/pong
 */
export function calculateTimeSync(
    clientSendTime: number,
    serverTime: number,
    clientReceiveTime: number
): TimeSyncResult {
    const rtt = clientReceiveTime - clientSendTime;
    // Estimate that the server timestamp was taken at the midpoint of RTT
    const oneWayDelay = rtt / 2;
    const offset = serverTime - (clientSendTime + oneWayDelay);

    return {
        rtt,
        offset,
        serverTimestamp: serverTime,
    };
}

/**
 * Create initial time sync state
 */
export function createTimeSyncState(maxSamples: number = 10): TimeSyncState {
    return {
        offset: 0,
        samples: [],
        maxSamples,
        initialized: false,
        lastSyncTime: 0,
    };
}

/**
 * Update time sync state with new sample
 * Uses median filtering to be robust against outliers
 */
export function updateTimeSyncState(state: TimeSyncState, result: TimeSyncResult): TimeSyncState {
    const newSamples = [...state.samples, result.offset].slice(-state.maxSamples);

    // Use median for robustness against outliers
    const sortedSamples = [...newSamples].sort((a, b) => a - b);
    const median = sortedSamples[Math.floor(sortedSamples.length / 2)];

    return {
        ...state,
        offset: median,
        samples: newSamples,
        initialized: true,
        lastSyncTime: Date.now(),
    };
}

/**
 * Get current server time based on local time and offset
 */
export function getServerTime(state: TimeSyncState): number {
    return Date.now() + state.offset;
}

/**
 * Calculate delay needed to execute at a specific server time
 * Returns negative if execution time has passed
 */
export function calculateExecutionDelay(
    executeAt: number,
    state: TimeSyncState
): number {
    const currentServerTime = getServerTime(state);
    return executeAt - currentServerTime;
}

/**
 * Schedule execution at a specific server time
 * Returns a function to cancel the scheduled execution
 */
export function scheduleAtServerTime(
    executeAt: number,
    state: TimeSyncState,
    callback: () => void,
    minDelay: number = 0
): { cancel: () => void; delay: number } {
    // Preserve the raw delay (can be negative) so callers can detect "already late".
    // Still clamp the actual timer delay to avoid scheduling negative timeouts.
    const rawDelay = calculateExecutionDelay(executeAt, state);
    const delay = Math.max(rawDelay, minDelay);

    const timeoutId = setTimeout(callback, delay);

    return {
        cancel: () => clearTimeout(timeoutId),
        delay: rawDelay,
    };
}

/**
 * Time ping message data
 */
export interface TimePingData {
    clientTimestamp: number;
}

/**
 * Time pong message data
 */
export interface TimePongData {
    clientTimestamp: number;
    serverTimestamp: number;
}

/**
 * Create ping data
 */
export function createTimePing(): TimePingData {
    return {
        clientTimestamp: Date.now(),
    };
}

/**
 * Create pong data (server side)
 */
export function createTimePong(pingData: TimePingData): TimePongData {
    return {
        clientTimestamp: pingData.clientTimestamp,
        serverTimestamp: Date.now(),
    };
}

/**
 * Process pong data and calculate sync result (client side)
 */
export function processTimePong(pongData: TimePongData): TimeSyncResult {
    const clientReceiveTime = Date.now();
    return calculateTimeSync(
        pongData.clientTimestamp,
        pongData.serverTimestamp,
        clientReceiveTime
    );
}

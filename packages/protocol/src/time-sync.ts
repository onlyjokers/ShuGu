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
    /** Optional RTT sample history aligned with `samples` (same indexing). */
    rttSamples?: number[];
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
        rttSamples: [],
        maxSamples,
        initialized: false,
        lastSyncTime: 0,
    };
}

/**
 * Update time sync state with new sample
 * Uses RTT-aware median filtering to reduce bias from asymmetric network delay.
 */
export function updateTimeSyncState(state: TimeSyncState, result: TimeSyncResult): TimeSyncState {
    const maxSamples = Math.max(1, state.maxSamples);
    const newSamples = [...state.samples, result.offset].slice(-maxSamples);

    const prevRtts = Array.isArray(state.rttSamples) ? state.rttSamples : [];
    const combinedRtts = [...prevRtts, result.rtt];
    const trimmedRtts = combinedRtts.slice(-newSamples.length);
    const newRttSamples =
        trimmedRtts.length === newSamples.length
            ? trimmedRtts
            : [
                ...Array(Math.max(0, newSamples.length - trimmedRtts.length)).fill(Number.POSITIVE_INFINITY),
                ...trimmedRtts,
            ];

    const median = (values: number[]): number => {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 0) {
            return (sorted[mid - 1] + sorted[mid]) / 2;
        }
        return sorted[mid];
    };

    // If we have enough RTT history, prefer the offsets from the lowest-RTT samples.
    // This follows the intuition behind NTP: smaller delay is more likely to be symmetric and accurate.
    const MIN_RTT_SAMPLES = 3;
    const pairs: Array<{ offset: number; rtt: number }> = [];
    for (let i = 0; i < newSamples.length; i++) {
        const rtt = newRttSamples[i];
        if (!Number.isFinite(rtt) || rtt < 0) continue;
        pairs.push({ offset: newSamples[i], rtt });
    }

    const estimateOffset = (): number => {
        if (pairs.length < MIN_RTT_SAMPLES) {
            return median(newSamples);
        }

        const sortedByRtt = [...pairs].sort((a, b) => a.rtt - b.rtt);
        const bestCount = Math.min(sortedByRtt.length, Math.max(3, Math.ceil(sortedByRtt.length * 0.25)));
        const bestOffsets = sortedByRtt.slice(0, bestCount).map((p) => p.offset);
        return median(bestOffsets);
    };

    const targetOffset = estimateOffset();
    const MAX_OFFSET_STEP_MS = 100;
    const nextOffset =
        state.initialized && Number.isFinite(state.offset)
            ? state.offset +
            Math.max(-MAX_OFFSET_STEP_MS, Math.min(MAX_OFFSET_STEP_MS, targetOffset - state.offset))
            : targetOffset;

    return {
        ...state,
        offset: nextOffset,
        samples: newSamples,
        rttSamples: newRttSamples,
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

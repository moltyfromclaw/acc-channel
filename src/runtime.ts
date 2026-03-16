/**
 * Runtime access for ACC channel
 * 
 * The runtime provides access to OpenClaw's session management APIs.
 * It can be injected by the gateway or we fall back to HTTP API calls.
 */

export interface SpawnOptions {
  task: string;
  label?: string;
  cleanup?: "delete" | "keep";
  runTimeoutSeconds?: number;
  model?: string;
  thinking?: string;
  onChunk?: (chunk: string) => void;
}

export interface SpawnResult {
  content?: string;
  sessionKey?: string;
  runId?: string;
}

export interface AccRuntimeSessions {
  spawn: (opts: SpawnOptions) => Promise<SpawnResult>;
}

export interface AccRuntimeContext {
  sessions: AccRuntimeSessions;
  gatewayUrl?: string;
  gatewayToken?: string;
}

let accRuntime: AccRuntimeContext | null = null;

/**
 * Set the runtime context (called by OpenClaw gateway when starting channel)
 */
export function setAccRuntime(runtime: AccRuntimeContext) {
  accRuntime = runtime;
}

/**
 * Check if runtime is available
 */
export function hasAccRuntime(): boolean {
  return accRuntime !== null && typeof accRuntime.sessions?.spawn === "function";
}

/**
 * Get the runtime context
 * @throws Error if runtime not initialized - use hasAccRuntime() to check first
 */
export function getAccRuntime(): AccRuntimeContext {
  if (!accRuntime) {
    throw new Error("ACC runtime not initialized");
  }
  return accRuntime;
}

/**
 * Clear the runtime (for testing or shutdown)
 */
export function clearAccRuntime() {
  accRuntime = null;
}

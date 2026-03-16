/**
 * ACC Channel Plugin for OpenClaw
 * 
 * Connects OpenClaw instances to Dispatch for orchestration.
 * Bidirectional WebSocket communication for tasks and streaming responses.
 * 
 * Supports two execution modes:
 * 1. Native sessions.spawn (if provided by OpenClaw gateway ctx)
 * 2. Cron API fallback (HTTP-based, always available)
 */

// Export the channel plugin (main entry point for OpenClaw)
export { accChannelPlugin } from "./channel.js";

// Export runtime utilities (for advanced usage / testing)
export { 
  setAccRuntime, 
  getAccRuntime, 
  hasAccRuntime, 
  clearAccRuntime,
  type AccRuntimeContext,
  type AccRuntimeSessions,
  type SpawnOptions,
  type SpawnResult,
} from "./runtime.js";

// Export types
export type {
  AccAccountConfig,
  AccChannelConfig,
  ResolvedAccAccount,
  AccProbe,
} from "./channel.js";

// Default export for OpenClaw plugin loader
import { accChannelPlugin } from "./channel.js";
export default accChannelPlugin;

/**
 * ACC Channel Implementation
 * 
 * WebSocket-based channel for Dispatch integration.
 * Supports two execution modes:
 * 1. Native sessions.spawn (if available in ctx)
 * 2. Cron API fallback (HTTP-based, always works)
 */

import type {
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";
import { hasAccRuntime, getAccRuntime, setAccRuntime, type SpawnResult } from "./runtime.js";

// ============================================================================
// Types
// ============================================================================

export interface AccAccountConfig {
  enabled?: boolean;
  serverUrl: string;
  agentName: string;
  token?: string;
  model?: string;
  taskTimeout?: number;
  reconnectInterval?: number;
  /** OpenClaw gateway URL for cron API fallback */
  gatewayUrl?: string;
  /** OpenClaw gateway token for cron API fallback */
  gatewayToken?: string;
}

export interface AccChannelConfig {
  enabled?: boolean;
  defaultAccount?: string;
  accounts?: Record<string, AccAccountConfig>;
}

export interface ResolvedAccAccount {
  accountId: string;
  enabled: boolean;
  serverUrl: string;
  agentName: string;
  token: string;
  model?: string;
  taskTimeout: number;
  reconnectInterval: number;
  gatewayUrl: string;
  gatewayToken: string;
  config: AccAccountConfig;
}

export interface AccProbe {
  ok: boolean;
  connected: boolean;
  registered: boolean;
  serverVersion?: string;
  error?: string;
}

// ============================================================================
// Config Helpers
// ============================================================================

const DEFAULT_ACCOUNT_ID = "default";
const DEFAULT_TASK_TIMEOUT = 300000; // 5 minutes
const DEFAULT_RECONNECT_INTERVAL = 5000; // 5 seconds
const DEFAULT_GATEWAY_URL = "http://localhost:18789";

function getAccConfig(cfg: OpenClawConfig): AccChannelConfig | undefined {
  return (cfg.channels as any)?.acc;
}

function listAccAccountIds(cfg: OpenClawConfig): string[] {
  const accCfg = getAccConfig(cfg);
  if (!accCfg?.accounts) {
    return accCfg?.enabled ? [DEFAULT_ACCOUNT_ID] : [];
  }
  return Object.keys(accCfg.accounts);
}

function resolveAccAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string;
}): ResolvedAccAccount {
  const { cfg, accountId = DEFAULT_ACCOUNT_ID } = params;
  const accCfg = getAccConfig(cfg);
  const accountCfg = accCfg?.accounts?.[accountId] ?? {} as AccAccountConfig;
  
  const serverUrl = accountCfg.serverUrl 
    ?? process.env.ACC_SERVER_URL 
    ?? "ws://localhost:3333/channel";
  
  const agentName = accountCfg.agentName 
    ?? process.env.ACC_AGENT_NAME 
    ?? "openclaw-agent";
  
  const token = accountCfg.token 
    ?? process.env.ACC_TOKEN 
    ?? "";

  const gatewayUrl = accountCfg.gatewayUrl
    ?? process.env.OPENCLAW_URL
    ?? DEFAULT_GATEWAY_URL;

  const gatewayToken = accountCfg.gatewayToken
    ?? process.env.OPENCLAW_TOKEN
    ?? "";

  return {
    accountId,
    enabled: accountCfg.enabled ?? true,
    serverUrl,
    agentName,
    token,
    model: accountCfg.model,
    taskTimeout: accountCfg.taskTimeout ?? DEFAULT_TASK_TIMEOUT,
    reconnectInterval: accountCfg.reconnectInterval ?? DEFAULT_RECONNECT_INTERVAL,
    gatewayUrl,
    gatewayToken,
    config: accountCfg,
  };
}

// ============================================================================
// Cron API Fallback
// ============================================================================

interface CronJobRun {
  status: "pending" | "running" | "completed" | "failed";
  result?: string;
  error?: string;
}

/**
 * Execute a task using OpenClaw's cron API
 * This is the fallback when sessions.spawn isn't available
 */
async function executeViaCronApi(params: {
  gatewayUrl: string;
  gatewayToken: string;
  taskId: string;
  message: string;
  model?: string;
  timeoutMs: number;
  onChunk?: (chunk: string) => void;
  log: { info: Function; warn: Function; error: Function; debug: Function };
}): Promise<SpawnResult> {
  const { gatewayUrl, gatewayToken, taskId, message, model, timeoutMs, log } = params;
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (gatewayToken) {
    headers["Authorization"] = `Bearer ${gatewayToken}`;
  }

  // Create a one-shot cron job that runs immediately
  const cronJob = {
    name: `acc-${taskId.slice(0, 8)}`,
    schedule: { kind: "at", at: new Date().toISOString() },
    sessionTarget: "isolated",
    payload: {
      kind: "agentTurn",
      message,
      model: model ?? "anthropic/claude-sonnet-4-20250514",
      thinking: "low",
      timeoutSeconds: Math.floor(timeoutMs / 1000),
    },
    delivery: {
      mode: "none", // We poll for result
    },
  };

  log.debug(`[cron-fallback] Creating cron job for task ${taskId}`);

  // Add the cron job
  const addResponse = await fetch(`${gatewayUrl}/api/cron`, {
    method: "POST",
    headers,
    body: JSON.stringify({ action: "add", job: cronJob }),
  });

  if (!addResponse.ok) {
    const errorText = await addResponse.text();
    throw new Error(`Failed to create cron job: ${addResponse.status} ${errorText}`);
  }

  const addResult = await addResponse.json() as { jobId?: string; id?: string; error?: string };
  const jobId = addResult.jobId ?? addResult.id;
  
  if (!jobId) {
    throw new Error(`No jobId returned from cron API: ${JSON.stringify(addResult)}`);
  }

  log.debug(`[cron-fallback] Created cron job: ${jobId}`);

  // Poll for completion
  const startTime = Date.now();
  const pollInterval = 2000; // 2 seconds
  
  while (Date.now() - startTime < timeoutMs) {
    await new Promise(r => setTimeout(r, pollInterval));
    
    try {
      const runsResponse = await fetch(`${gatewayUrl}/api/cron?action=runs&jobId=${jobId}`, {
        headers,
      });
      
      if (runsResponse.ok) {
        const runsResult = await runsResponse.json() as { runs?: CronJobRun[] };
        const lastRun = runsResult.runs?.[0];
        
        if (lastRun?.status === "completed") {
          log.debug(`[cron-fallback] Task ${taskId} completed via cron`);
          return { content: lastRun.result ?? "Task completed" };
        } else if (lastRun?.status === "failed") {
          throw new Error(lastRun.error ?? lastRun.result ?? "Task failed");
        }
        // Still pending/running, continue polling
      }
    } catch (pollError: any) {
      // Log but continue polling (might be transient network error)
      log.warn(`[cron-fallback] Poll error: ${pollError.message}`);
    }
  }

  throw new Error(`Task timeout after ${timeoutMs}ms`);
}

// ============================================================================
// Channel Plugin
// ============================================================================

export const accChannelPlugin: ChannelPlugin = {
  id: "acc",
  
  meta: {
    id: "acc",
    label: "Dispatch",
    selectionLabel: "ACC (WebSocket)",
    docsPath: "/channels/acc",
    blurb: "Connect OpenClaw to Dispatch via WebSocket.",
    aliases: ["acc", "command-center"],
  },

  capabilities: {
    chatTypes: ["direct"],
    reactions: false,
    threads: false,
    media: false,
    nativeCommands: false,
    blockStreaming: false, // We support streaming!
  },

  reload: { configPrefixes: ["channels.acc"] },

  config: {
    listAccountIds: (cfg) => listAccAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveAccAccount({ cfg, accountId: accountId ?? undefined }),
    defaultAccountId: (cfg) => getAccConfig(cfg)?.defaultAccount ?? DEFAULT_ACCOUNT_ID,
    
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const next = { ...cfg };
      const channels = { ...next.channels } as any;
      const acc = { ...channels.acc } as AccChannelConfig;
      const accounts = { ...acc.accounts };
      
      if (accounts[accountId]) {
        accounts[accountId] = { ...accounts[accountId], enabled };
      }
      
      acc.accounts = accounts;
      channels.acc = acc;
      next.channels = channels;
      return next;
    },
    
    deleteAccount: ({ cfg, accountId }) => {
      const next = { ...cfg };
      const channels = { ...next.channels } as any;
      const acc = { ...channels.acc } as AccChannelConfig;
      const accounts = { ...acc.accounts };
      
      delete accounts[accountId];
      
      acc.accounts = accounts;
      channels.acc = acc;
      next.channels = channels;
      return next;
    },
    
    isConfigured: (account) => Boolean(account.serverUrl?.trim()),
    
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.agentName,
      enabled: account.enabled,
      configured: Boolean(account.serverUrl?.trim()),
    }),
  },

  outbound: {
    deliveryMode: "direct",
    
    sendText: async ({ to, text, accountId }) => {
      // ACC is primarily inbound (tasks come from ACC)
      // Outbound is handled via WebSocket task.completed messages
      // This is a fallback for any direct send attempts
      console.log(`[acc] sendText called: to=${to}, accountId=${accountId}`);
      return { ok: true, channel: "acc", messageId: `acc-${Date.now()}` };
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      connected: false,
      lastStartAt: undefined,
      lastStopAt: undefined,
      lastError: undefined,
    },
    
    collectStatusIssues: (accounts: any[]) => {
      const issues: any[] = [];
      
      for (const snap of accounts) {
        const account = snap.account ?? snap;
        const runtime = snap.runtime;
        if (!account?.serverUrl) {
          issues.push({ channel: "acc", accountId: account?.accountId ?? "default", kind: "error", level: "error", message: "ACC server URL not configured" });
        }
        if (runtime && !runtime.connected) {
          issues.push({ channel: "acc", accountId: account?.accountId ?? "default", kind: "warning", level: "warning", message: "Not connected to ACC server" });
        }
      }
      
      return issues;
    },
    
    buildChannelSummary: (params: any) => {
      const snapshot = params?.snapshot ?? params;
      return {
        configured: snapshot?.configured ?? false,
        running: snapshot?.running ?? false,
        connected: snapshot?.connected ?? false,
      };
    },
    
    probeAccount: async ({ account, timeoutMs }: any) => {
      // TODO: Implement actual probe (test WebSocket connection)
      return {
        ok: Boolean((account as any)?.serverUrl),
        connected: false,
      };
    },
    
    buildAccountSnapshot: ({ account, runtime }: any) => ({
      accountId: account.accountId,
      name: account.agentName,
      enabled: account.enabled,
      configured: Boolean(account.serverUrl?.trim()),
      running: runtime?.running ?? false,
      connected: runtime?.connected ?? false,
      lastStartAt: runtime?.lastStartAt ?? undefined,
      lastStopAt: runtime?.lastStopAt ?? undefined,
      lastError: runtime?.lastError ?? undefined,
    }),
  },

  gateway: {
    startAccount: async (ctx: any) => {
      const { account, cfg, runtime, abortSignal, log: _log } = ctx;
      const log = _log ?? { info: console.log, warn: console.warn, error: console.error, debug: console.log };
      
      log.info(`[acc:${account.accountId}] Starting ACC channel...`);
      log.info(`[acc:${account.accountId}] Server: ${account.serverUrl}`);
      log.info(`[acc:${account.accountId}] Agent: ${account.agentName}`);
      
      // Check if ctx provides sessions API (native OpenClaw integration)
      const ctxSessions = ctx.sessions ?? ctx.runtime?.sessions;
      const useNativeSessions = ctxSessions && typeof ctxSessions.spawn === "function";
      
      if (useNativeSessions) {
        log.info(`[acc:${account.accountId}] Using native sessions.spawn`);
        // Store in runtime module for potential direct access
        setAccRuntime({ 
          sessions: ctxSessions,
          gatewayUrl: account.gatewayUrl,
          gatewayToken: account.gatewayToken,
        });
      } else {
        log.info(`[acc:${account.accountId}] Using cron API fallback (gateway: ${account.gatewayUrl})`);
      }
      
      // Import WebSocket dynamically
      const { default: WebSocket } = await import("ws");
      
      // Connection state
      let ws: InstanceType<typeof WebSocket> | null = null;
      let reconnectTimer: NodeJS.Timeout | null = null;
      const activeTasks = new Map<string, { startedAt: number; aborted?: boolean }>();
      
      // Update runtime state
      const updateRuntime = (updates: Record<string, any>) => {
        if (runtime) {
          Object.assign(runtime, updates);
        }
      };
      
      // Connect to ACC server
      const connect = () => {
        if (abortSignal?.aborted) return;
        
        log.debug(`[acc:${account.accountId}] Connecting to ${account.serverUrl}`);
        
        ws = new WebSocket(account.serverUrl, {
          headers: {
            "Authorization": `Bearer ${account.token}`,
            "X-Agent-Name": account.agentName,
          },
        });
        
        ws.on("open", () => {
          log.info(`[acc:${account.accountId}] Connected to ACC server`);
          updateRuntime({ connected: true, lastError: null });
          
          // Register with ACC
          ws?.send(JSON.stringify({
            type: "register",
            metadata: {
              agentName: account.agentName,
              capabilities: ["streaming", "tools", "spawn"],
              model: account.model ?? (cfg.agents as any)?.defaults?.model ?? "anthropic/claude-sonnet-4-20250514",
              version: "1.0.0",
              executionMode: useNativeSessions ? "native" : "cron-fallback",
            },
          }));
          
          updateRuntime({ registered: true });
          log.info(`[acc:${account.accountId}] Registered as ${account.agentName}`);
        });
        
        ws.on("message", async (data) => {
          try {
            const msg = JSON.parse(data.toString());
            log.debug(`[acc:${account.accountId}] Received: ${msg.type}`);
            
            switch (msg.type) {
              case "task.send":
                await handleTaskSend(msg);
                break;
              case "task.cancel":
                handleTaskCancel(msg);
                break;
              case "ping":
                ws?.send(JSON.stringify({ type: "pong" }));
                break;
            }
          } catch (err) {
            log.error(`[acc:${account.accountId}] Message handling error: ${err}`);
          }
        });
        
        ws.on("close", (code) => {
          log.info(`[acc:${account.accountId}] Disconnected (code: ${code})`);
          updateRuntime({ connected: false, registered: false });
          scheduleReconnect();
        });
        
        ws.on("error", (err) => {
          log.error(`[acc:${account.accountId}] WebSocket error: ${err.message}`);
          updateRuntime({ lastError: err.message });
        });
      };
      
      // Schedule reconnection
      const scheduleReconnect = () => {
        if (abortSignal?.aborted || reconnectTimer) return;
        
        log.debug(`[acc:${account.accountId}] Reconnecting in ${account.reconnectInterval}ms`);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, account.reconnectInterval);
      };
      
      // Handle incoming task
      const handleTaskSend = async (msg: { taskId: string; message: string; context?: any }) => {
        const { taskId, message, context } = msg;
        
        if (!taskId || !message) {
          ws?.send(JSON.stringify({
            type: "task.error",
            taskId: taskId ?? "unknown",
            error: "Missing taskId or message",
          }));
          return;
        }
        
        log.info(`[acc:${account.accountId}] Task received: ${taskId}`);
        log.debug(`[acc:${account.accountId}] Task message: ${message.slice(0, 100)}...`);
        
        const startedAt = Date.now();
        activeTasks.set(taskId, { startedAt });
        
        // Send started acknowledgment
        ws?.send(JSON.stringify({
          type: "task.started",
          taskId,
          metadata: { startedAt: new Date(startedAt).toISOString() },
        }));
        
        try {
          let result: SpawnResult;
          
          // Try native sessions.spawn first
          if (useNativeSessions && ctxSessions) {
            log.debug(`[acc:${account.accountId}] Executing via native sessions.spawn`);
            result = await ctxSessions.spawn({
              task: message,
              label: `acc-${taskId.slice(0, 8)}`,
              cleanup: "delete",
              runTimeoutSeconds: Math.floor(account.taskTimeout / 1000),
              model: account.model,
            });
          } else {
            // Fallback to cron API
            log.debug(`[acc:${account.accountId}] Executing via cron API fallback`);
            result = await executeViaCronApi({
              gatewayUrl: account.gatewayUrl,
              gatewayToken: account.gatewayToken,
              taskId,
              message,
              model: account.model,
              timeoutMs: account.taskTimeout,
              log,
            });
          }
          
          // Check if task was cancelled while executing
          const taskState = activeTasks.get(taskId);
          if (taskState?.aborted) {
            log.info(`[acc:${account.accountId}] Task ${taskId} was cancelled during execution`);
            return;
          }
          
          const durationMs = Date.now() - startedAt;
          log.info(`[acc:${account.accountId}] Task completed: ${taskId} (${durationMs}ms)`);
          
          ws?.send(JSON.stringify({
            type: "task.completed",
            taskId,
            content: result?.content ?? "Task completed",
            status: "completed",
            metadata: { durationMs },
          }));
          
        } catch (err: any) {
          const durationMs = Date.now() - startedAt;
          const errorMessage = err?.message ?? String(err);
          log.error(`[acc:${account.accountId}] Task failed: ${taskId} - ${errorMessage}`);
          
          ws?.send(JSON.stringify({
            type: "task.error",
            taskId,
            error: errorMessage,
            status: "failed",
            metadata: { durationMs },
          }));
        } finally {
          activeTasks.delete(taskId);
        }
      };
      
      // Handle task cancellation
      const handleTaskCancel = (msg: { taskId: string }) => {
        const { taskId } = msg;
        const taskState = activeTasks.get(taskId);
        if (taskState) {
          log.info(`[acc:${account.accountId}] Cancelling task: ${taskId}`);
          taskState.aborted = true;
          ws?.send(JSON.stringify({ type: "task.cancelled", taskId }));
        }
      };
      
      // Cleanup on abort
      abortSignal?.addEventListener("abort", () => {
        log.info(`[acc:${account.accountId}] Shutting down ACC channel`);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) ws.close();
        updateRuntime({ running: false, connected: false, registered: false });
      });
      
      // Start connection
      updateRuntime({ 
        running: true, 
        lastStartAt: Date.now(),
        accountId: account.accountId,
      });
      connect();
      
      // Return cleanup function
      return () => {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        if (ws) ws.close();
      };
    },
    
    logoutAccount: async ({ accountId, cfg }) => {
      // Remove token from config
      const next = { ...cfg };
      const channels = { ...next.channels } as any;
      const acc = { ...channels.acc } as AccChannelConfig;
      const accounts = { ...acc.accounts };
      
      if (accounts[accountId]) {
        const { token, ...rest } = accounts[accountId];
        accounts[accountId] = rest;
      }
      
      acc.accounts = accounts;
      channels.acc = acc;
      next.channels = channels;
      
      return { cleared: true, loggedOut: true };
    },
  },
};

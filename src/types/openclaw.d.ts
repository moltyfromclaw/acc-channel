/**
 * Type declarations for openclaw/plugin-sdk
 * 
 * These are minimal types to satisfy TypeScript compilation.
 * The actual types come from the openclaw peer dependency at runtime.
 */

declare module "openclaw/plugin-sdk" {
  export interface OpenClawConfig {
    channels?: Record<string, unknown>;
    agents?: {
      defaults?: {
        model?: string;
      };
    };
    [key: string]: unknown;
  }

  export interface ChannelCapabilities {
    chatTypes: string[];
    reactions: boolean;
    threads: boolean;
    media: boolean;
    nativeCommands: boolean;
    blockStreaming: boolean;
  }

  export interface ChannelMeta {
    id: string;
    label: string;
    selectionLabel: string;
    docsPath?: string;
    blurb: string;
    aliases?: string[];
  }

  export interface ChannelRuntime {
    accountId: string;
    running: boolean;
    connected: boolean;
    lastStartAt?: number;
    lastStopAt?: number;
    lastError?: string;
    [key: string]: unknown;
  }

  export interface ChannelPlugin {
    id: string;
    meta: ChannelMeta;
    capabilities: ChannelCapabilities;
    reload?: { configPrefixes: string[] };
    config: {
      listAccountIds: (cfg: OpenClawConfig) => string[];
      resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) => unknown;
      defaultAccountId: (cfg: OpenClawConfig) => string;
      setAccountEnabled?: (params: { cfg: OpenClawConfig; accountId: string; enabled: boolean }) => OpenClawConfig;
      deleteAccount?: (params: { cfg: OpenClawConfig; accountId: string }) => OpenClawConfig;
      isConfigured: (account: unknown) => boolean;
      describeAccount: (account: unknown) => {
        accountId: string;
        name: string;
        enabled: boolean;
        configured: boolean;
      };
    };
    outbound: {
      deliveryMode: "direct" | "queued";
      sendText: (params: { to: string; text: string; accountId?: string }) => Promise<{ ok: boolean; channel: string; messageId: string }>;
    };
    status: {
      defaultRuntime: ChannelRuntime;
      collectStatusIssues: (accounts: unknown[]) => unknown[];
      buildChannelSummary: (params: unknown) => { configured: boolean; running: boolean; connected: boolean };
      probeAccount: (params: { account: unknown; timeoutMs?: number }) => Promise<{ ok: boolean; connected: boolean }>;
      buildAccountSnapshot: (params: { account: unknown; runtime: unknown }) => unknown;
    };
    gateway: {
      startAccount: (ctx: GatewayStartContext) => Promise<(() => void) | void>;
      logoutAccount?: (params: { accountId: string; cfg: OpenClawConfig }) => Promise<{ cleared: boolean; loggedOut: boolean }>;
    };
  }

  export interface GatewayStartContext {
    account: {
      accountId: string;
      serverUrl: string;
      agentName: string;
      token: string;
      model?: string;
      taskTimeout: number;
      reconnectInterval: number;
      gatewayUrl: string;
      gatewayToken: string;
      [key: string]: unknown;
    };
    cfg: OpenClawConfig;
    runtime: ChannelRuntime;
    abortSignal?: AbortSignal;
    log: {
      info: (msg: string, ...args: unknown[]) => void;
      warn: (msg: string, ...args: unknown[]) => void;
      error: (msg: string, ...args: unknown[]) => void;
      debug: (msg: string, ...args: unknown[]) => void;
    };
    sessions?: {
      spawn: (opts: {
        task: string;
        label?: string;
        cleanup?: "delete" | "keep";
        runTimeoutSeconds?: number;
        model?: string;
      }) => Promise<{ content?: string; sessionKey?: string; runId?: string }>;
    };
    [key: string]: unknown;
  }
}

export type HookEvent =
  | 'session-start'
  | 'pre-tool'
  | 'post-tool'
  | 'pre-commit'
  | 'post-task'
  | 'pre-phase'
  | 'post-phase'
  | 'on-error'
  | 'on-stop';

export interface EventPayload {
  event: HookEvent;
  timestamp: string;
  data?: Record<string, unknown>;
}

export type EventHandler = (payload: EventPayload) => Promise<void> | void;

// ── MCP event-bridge types ──

/**
 * An MCP event type — an arbitrary string identifying the kind of
 * MCP-simulated event (e.g. `'mcp:tool-start'`, `'mcp:tool-end'`).
 */
export type MCPEventType = string;

/**
 * Payload delivered to MCP event handlers.
 */
export interface MCPEventPayload {
  eventType: MCPEventType;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Handler invoked when an MCP event is emitted.
 */
export type MCPEventHandler = (payload: MCPEventPayload) => Promise<void> | void;

export class EventBus {
  private handlers: Map<HookEvent, EventHandler[]> = new Map();
  private history: EventPayload[] = [];

  // MCP event-bridge storage
  private mcpHandlers: Map<MCPEventType, MCPEventHandler[]> = new Map();
  private mcpHistory: MCPEventPayload[] = [];

  on(event: HookEvent, handler: EventHandler): void {
    const existing = this.handlers.get(event) || [];
    existing.push(handler);
    this.handlers.set(event, existing);
  }

  off(event: HookEvent, handler: EventHandler): void {
    const existing = this.handlers.get(event);
    if (existing) {
      this.handlers.set(event, existing.filter(h => h !== handler));
    }
  }

  async emit(event: HookEvent, data?: Record<string, unknown>): Promise<void> {
    const payload: EventPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };
    this.history.push(payload);

    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        await handler(payload);
      }
    }
  }

  getHistory(event?: HookEvent): EventPayload[] {
    if (event) {
      return this.history.filter(h => h.event === event);
    }
    return [...this.history];
  }

  clear(): void {
    this.handlers.clear();
    this.history = [];
    this.mcpHandlers.clear();
    this.mcpHistory = [];
  }

  // ── MCP event-bridge methods ──

  /**
   * Register a handler for an MCP-simulated event type.
   *
   * MCP events are separate from the standard {@link HookEvent} stream.
   * They allow clients that lack native Hook support to participate in
   * the event lifecycle through the MCP bridge.
   *
   * @param eventType - The MCP event type to listen for.
   * @param handler   - The handler to invoke when the event is emitted.
   *
   * @example
   * ```ts
   * bus.registerMCPHandler('mcp:tool-start', (payload) => {
   *   console.log('Tool started:', payload.data?.tool);
   * });
   * ```
   */
  registerMCPHandler(eventType: MCPEventType, handler: MCPEventHandler): void {
    const existing = this.mcpHandlers.get(eventType) || [];
    existing.push(handler);
    this.mcpHandlers.set(eventType, existing);
  }

  /**
   * Emit an MCP-simulated event.
   *
   * All registered handlers for the given `eventType` are invoked
   * sequentially (awaiting each one). The event is also recorded in
   * the MCP history.
   *
   * @param eventType - The MCP event type to emit.
   * @param payload   - Optional data to include in the event payload.
   *
   * @example
   * ```ts
   * await bus.emitMCPEvent('mcp:tool-end', { tool: 'aza_prd_generate', result: 'ok' });
   * ```
   */
  async emitMCPEvent(
    eventType: MCPEventType,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const mcpPayload: MCPEventPayload = {
      eventType,
      timestamp: new Date().toISOString(),
      data: payload,
    };
    this.mcpHistory.push(mcpPayload);

    const handlers = this.mcpHandlers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        await handler(mcpPayload);
      }
    }
  }

  /**
   * Get MCP event history, optionally filtered by event type.
   *
   * @param eventType - If provided, only events of this type are returned.
   * @returns A copy of the MCP event history.
   */
  getMCPHistory(eventType?: MCPEventType): MCPEventPayload[] {
    if (eventType) {
      return this.mcpHistory.filter(h => h.eventType === eventType);
    }
    return [...this.mcpHistory];
  }
}

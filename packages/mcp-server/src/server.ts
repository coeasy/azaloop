#!/usr/bin/env node
/**
 * MCP stdio transport — reads JSON-RPC from stdin, dispatches to handleToolCall, writes to stdout.
 *
 * MCP Protocol (2024-11-05):
 *   1. Client sends "initialize" request
 *   2. Server responds with capabilities
 *   3. Client sends "notifications/initialized"
 *   4. Client sends "tools/list" → tools/call → ... → lifecycle ends
 *
 * All I/O is line-delimited JSON on stdin/stdout.
 */

import { createInterface } from 'readline';
import { stdin, stdout, stderr } from 'process';
import { handleToolCall, getToolDefinitions } from './index';

interface JSONRPCRequest {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
}

interface JSONRPCResponse {
  jsonrpc: string;
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Handle a JSON-RPC request and return a response.
 * Follows MCP protocol 2024-11-05.
 */
async function handleRequest(req: JSONRPCRequest): Promise<JSONRPCResponse> {
  const id = req.id ?? null;
  const method = req.method ?? '';

  // ── initialize — REQUIRED by MCP protocol ──
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {
            listChanged: false,
          },
        },
        serverInfo: {
          name: 'azaloop',
          version: '0.1.0',
        },
      },
    };
  }

  // ── notifications/initialized — no response ──
  if (method === 'notifications/initialized') {
    return { jsonrpc: '2.0', id: null, result: null };
  }

  // ── notifications/cancelled — no response ──
  if (method === 'notifications/cancelled') {
    return { jsonrpc: '2.0', id: null, result: null };
  }

  // ── tools/list ──
  if (method === 'tools/list') {
    const tools = getToolDefinitions().map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }));
    return {
      jsonrpc: '2.0',
      id,
      result: { tools },
    };
  }

  // ── tools/call ──
  if (method === 'tools/call') {
    const name = (req.params as any)?.name as string;
    const argumentsObj = (req.params as any)?.arguments ?? {};

    if (!name) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32600, message: 'Missing tool name' },
      };
    }

    try {
      const result = await handleToolCall(name, argumentsObj);
      const resultText = JSON.stringify(result, null, 2);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: resultText }],
        },
      };
    } catch (err: any) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: `Tool call failed: ${err.message}`,
          data: { error: err.message },
        },
      };
    }
  }

  // ── ping ──
  if (method === 'ping') {
    return {
      jsonrpc: '2.0',
      id,
      result: { status: 'ok' },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32601,
      message: `Method not found: ${req.method}`,
    },
  };
}

/**
 * MCP stdio transport loop.
 * Reads JSON-RPC line-delimited messages from stdin and writes responses to stdout.
 */
async function main(): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
    terminal: false,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const req = JSON.parse(line) as JSONRPCRequest;
      const response = await handleRequest(req);

      // Notifications have id:null — skip writing a response
      if (response.id === null && response.result === null) {
        continue;
      }

      stdout.write(JSON.stringify(response) + '\n');
    } catch (err: any) {
      const errorResponse: JSONRPCResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err.message}`,
        },
      };
      stdout.write(JSON.stringify(errorResponse) + '\n');
    }
  }
}

main().catch((err) => {
  stderr.write(`MCP Server error: ${err.message}\n`);
  process.exit(1);
});

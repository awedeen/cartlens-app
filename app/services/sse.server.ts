// Server-Sent Events connection manager

export interface SSEClient {
  id: string;
  shopId: string;
  controller: ReadableStreamDefaultController;
}

class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  public readonly instanceId: string;

  constructor() {
    this.instanceId = `sse-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[SSE Manager] Created new instance: ${this.instanceId}`);
  }

  addClient(client: SSEClient): boolean {
    // Cap at 10 concurrent SSE connections per shop (prevents tab/connection flooding)
    const shopClientCount = Array.from(this.clients.values()).filter(
      (c) => c.shopId === client.shopId
    ).length;
    if (shopClientCount >= 10) {
      console.warn(`[SSE Manager ${this.instanceId}] Connection limit reached for shop ${client.shopId}, rejecting client ${client.id}`);
      try { client.controller.close(); } catch {}
      return false;
    }
    this.clients.set(client.id, client);
    console.log(`[SSE Manager ${this.instanceId}] Client connected: ${client.id} for shop ${client.shopId} (total clients: ${this.clients.size})`);
    return true;
  }

  removeClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
      console.log(`[SSE Manager ${this.instanceId}] Client disconnected: ${clientId} (total clients: ${this.clients.size})`);
    }
  }

  broadcast(shopId: string, event: string, data: any) {
    const shopClients = Array.from(this.clients.values()).filter(
      (client) => client.shopId === shopId
    );

    console.log(`[SSE Manager ${this.instanceId}] Broadcasting "${event}" to ${shopClients.length} clients for shop ${shopId} (total clients: ${this.clients.size})`);
    
    if (shopClients.length === 0) {
      console.warn(`[SSE Manager ${this.instanceId}] WARNING: No clients connected for shop ${shopId}. Broadcast will not be delivered.`);
    }

    for (const client of shopClients) {
      try {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        client.controller.enqueue(new TextEncoder().encode(message));
        console.log(`[SSE Manager ${this.instanceId}] Sent "${event}" to client ${client.id}`);
      } catch (error) {
        console.error(`[SSE Manager ${this.instanceId}] Error sending to client ${client.id}:`, error);
        this.removeClient(client.id);
      }
    }
  }

  getClientCount(shopId?: string): number {
    if (shopId) {
      return Array.from(this.clients.values()).filter(
        (client) => client.shopId === shopId
      ).length;
    }
    return this.clients.size;
  }
}

// Singleton instance using globalThis (more standard than global)
// This ensures the same instance is shared across all module contexts
declare global {
  var __sseManager: SSEManager | undefined;
}

let sseManager: SSEManager;

if (process.env.NODE_ENV !== "production") {
  // Development: use global singleton to survive HMR
  if (!globalThis.__sseManager) {
    globalThis.__sseManager = new SSEManager();
    console.log(`[SSE] Initialized global singleton: ${globalThis.__sseManager.instanceId}`);
  } else {
    console.log(`[SSE] Reusing existing singleton: ${globalThis.__sseManager.instanceId}`);
  }
  sseManager = globalThis.__sseManager;
} else {
  // Production: create new instance
  sseManager = new SSEManager();
}

console.log(`[SSE] Module loaded, using instance: ${sseManager.instanceId}`);

export default sseManager;

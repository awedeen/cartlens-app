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
    this.instanceId = `sse-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
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
    return true;
  }

  removeClient(clientId: string) {
    const client = this.clients.get(clientId);
    if (client) {
      this.clients.delete(clientId);
    }
  }

  broadcast(shopId: string, event: string, data: any) {
    const shopClients = Array.from(this.clients.values()).filter(
      (client) => client.shopId === shopId
    );
    
    for (const client of shopClients) {
      try {
        const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        client.controller.enqueue(new TextEncoder().encode(message));
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

// Singleton in all environments — ensures the same SSEManager instance is used
// across module loads in dev (HMR) and in prod (prevents split-brain broadcasts).
declare global {
  var __sseManager: SSEManager | undefined;
}

if (!globalThis.__sseManager) {
  globalThis.__sseManager = new SSEManager();
}

const sseManager = globalThis.__sseManager;

export default sseManager;

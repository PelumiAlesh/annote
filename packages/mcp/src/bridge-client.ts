import { bridgeBaseUrl, DEFAULT_BRIDGE_PORT, type AnnoteConfig } from "./config.js";

export class BridgeClient {
  constructor(
    private config: AnnoteConfig,
    private port = DEFAULT_BRIDGE_PORT,
  ) {}

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${bridgeBaseUrl(this.port)}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-annote-internal-secret": this.config.machineSecret,
      },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : {};
    if (!response.ok) {
      const message = typeof parsed.error === "string" ? parsed.error : `Bridge request failed: ${response.status}`;
      throw new Error(message);
    }
    return parsed as T;
  }
}

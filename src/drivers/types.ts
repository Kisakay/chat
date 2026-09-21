export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DriverModel {
  /** Fully-qualified id, e.g. "ollama:llama3.1" */
  id: string;
  /** Short model name, e.g. "llama3.1" */
  name: string;
  /** Driver name, e.g. "ollama" */
  driver: string;
  label: string;
  /** Display category in the model picker (defaults to `driver`). */
  group?: string;
  /** True when served through the caller's own provider key (BYOK) rather
   *  than the platform key — the UI lists these in their own section. */
  personal?: boolean;
}

export interface ChatOptions {
  model: string; // short name within the driver
  signal?: AbortSignal;
  onToken?: (token: string) => void;
}

/**
 * Driver interface (class-oriented as per spec).
 * Each LLM backend (ollama, mistral, puppeteer, ...) implements this.
 */
export interface LLMDriver {
  readonly name: string;
  readonly enabled: boolean;
  /** List models exposed by this driver. */
  listModels(): Promise<DriverModel[]>;
  /** Non-streaming chat completion. */
  chat(messages: ChatMessage[], opts: ChatOptions): Promise<string>;
  /** Streaming chat completion (SSE tokens). */
  chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string, void, void>;
}

export class DriverDisabledError extends Error {
  constructor(driver: string) {
    super(`driver "${driver}" is disabled / not configured`);
    this.name = "DriverDisabledError";
  }
}

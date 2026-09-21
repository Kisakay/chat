import { OcrTool } from "./ocr.ts";
import type { PlatformTool } from "./types.ts";

/** Platform tools registry (upload flows always go through tools). */
class ToolRegistry {
  readonly ocr = new OcrTool();
  private tools: PlatformTool[] = [this.ocr];

  async init(): Promise<void> {
    await this.ocr.init();
  }

  list(): { name: string; description: string; available: boolean; reason: string | null }[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
      available: t.isAvailable(),
      reason: t.unavailableReason(),
    }));
  }
}

export const tools = new ToolRegistry();

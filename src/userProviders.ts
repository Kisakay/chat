import { db } from "./db.ts";
import { AnthropicDriver, DeepSeekDriver, GeminiDriver, OpenAIDriver } from "./drivers/apis.ts";
import type { DriverModel, LLMDriver } from "./drivers/types.ts";

/**
 * Personal LLM providers (BYOK): users attach their own API keys in
 * settings, and the matching models show up in their model menu.
 *
 * Security notes (do not weaken):
 * - Keys are stored reversibly server-side (they must be sent upstream) and
 *   are NEVER returned to any client — GET only exposes presence + last4.
 * - Never log or print keys. Key material only travels server -> provider.
 * - Scoping is per account: every helper takes userId and all chat/model
 *   routes resolve keys for the caller only.
 */

// Providers a user may connect themselves. Keep in sync with the settings
// UI (frontend PROVIDER_META) and the docs.
export const USER_PROVIDER_IDS = ["openai", "anthropic", "deepseek", "gemini"] as const;
export type UserProviderId = (typeof USER_PROVIDER_IDS)[number];

export const USER_PROVIDER_LABELS: Record<UserProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  gemini: "Gemini",
};

export function isUserProviderId(v: string): v is UserProviderId {
  return (USER_PROVIDER_IDS as readonly string[]).includes(v);
}

/** User-supplied key validation: trimmed printable secret, 8–256 chars. */
export function validProviderKey(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length < 8 || t.length > 256) return null;
  if (/[\s]/.test(t)) return null;
  return t;
}

export interface UserProviderStatus {
  provider: UserProviderId;
  label: string;
  hasKey: boolean;
  /** Last 4 chars of the stored key (for recognition), or null when unset. */
  last4: string | null;
  updatedAt: number;
}

export async function getUserProviderKey(userId: string, provider: UserProviderId): Promise<string | null> {
  const r = await db().get<{ api_key: string }>(
    "SELECT api_key FROM user_provider_keys WHERE user_id = ? AND provider = ?",
    userId, provider,
  );
  return r?.api_key ?? null;
}

export async function listUserProviders(userId: string): Promise<UserProviderStatus[]> {
  const rows = await db().all<{ provider: string; api_key: string; updated_at: number }>(
    "SELECT provider, api_key, updated_at FROM user_provider_keys WHERE user_id = ?",
    userId,
  );
  const byId = new Map(rows.map((r) => [r.provider, r]));
  return USER_PROVIDER_IDS.map((p) => {
    const r = byId.get(p);
    return {
      provider: p,
      label: USER_PROVIDER_LABELS[p],
      hasKey: !!r,
      last4: r ? r.api_key.slice(-4) : null,
      updatedAt: r?.updated_at ?? 0,
    };
  });
}

export async function setUserProviderKey(userId: string, provider: UserProviderId, apiKey: string): Promise<void> {
  await db().run(
    "INSERT INTO user_provider_keys (user_id, provider, api_key, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, provider) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at",
    userId, provider, apiKey, Date.now(),
  );
}

export async function deleteUserProviderKey(userId: string, provider: UserProviderId): Promise<void> {
  await db().run("DELETE FROM user_provider_keys WHERE user_id = ? AND provider = ?", userId, provider);
}

/** Build a per-user driver instance authenticated with the user's own key. */
export function buildUserProviderDriver(provider: UserProviderId, apiKey: string): LLMDriver {
  switch (provider) {
    case "openai":
      return new OpenAIDriver(apiKey);
    case "anthropic":
      return new AnthropicDriver(apiKey);
    case "deepseek":
      return new DeepSeekDriver(apiKey);
    case "gemini":
      return new GeminiDriver(apiKey);
  }
}

/**
 * List models reachable with the user's own keys. Every entry is marked
 * `personal: true` so the UI can list them in their own menu section.
 * Never throws: a failing provider is skipped (its driver falls back to a
 * static list, and only a total failure is swallowed here).
 */
export async function listUserProviderModels(userId: string): Promise<DriverModel[]> {
  const out: DriverModel[] = [];
  const jobs = USER_PROVIDER_IDS.map(async (p) => {
    const key = await getUserProviderKey(userId, p);
    if (!key) return;
    try {
      for (const m of await buildUserProviderDriver(p, key).listModels()) {
        out.push({ ...m, personal: true });
      }
    } catch (e) {
      console.error(`[providers] user ${p} listModels failed:`, (e as Error).message);
    }
  });
  await Promise.all(jobs);
  return out;
}

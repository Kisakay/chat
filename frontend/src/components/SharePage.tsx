import { useEffect, useState } from "react";
import { Bot, CloudOff, Globe, User as UserIcon } from "lucide-react";
import { api } from "../lib/api.ts";
import type { SharedChat } from "../lib/types.ts";
import { AssistantAvatar, Avatar, FlowerMark } from "./ui.tsx";
import { Markdown } from "./Markdown.tsx";

export function SharePage({ publicId }: { publicId: string }) {
  const [chat, setChat] = useState<SharedChat | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.publicShare(publicId)
      .then(setChat)
      .catch((err) => setError(err instanceof Error ? err.message : "Not found"));
  }, [publicId]);

  return (
    <div className="min-h-full">
      <header className="border-b border-stone-200/70 bg-white/70 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2.5 px-4 py-3">
          <FlowerMark size={36} dynamic={false} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{chat?.title ?? "Shared chat"}</p>
            {chat && (
              <p className="flex items-center gap-1.5 text-xs opacity-60">
                <Globe size={11} /> by {chat.authorName} · {new Date(chat.sharedAt).toLocaleDateString()}
                {chat.model && <> · {chat.model.split(":").pop()}</>}
              </p>
            )}
          </div>
          <a href="/" className="rounded-full bg-accent-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-accent-500 dark:bg-accent-500 dark:text-zinc-950">
            Open KisAssistant
          </a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6">
        {error && <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-400">{error}</p>}
        {!chat && !error && <p className="py-16 text-center text-sm opacity-60">Loading shared chat…</p>}
        {chat?.messages.map((m, i) => (
          <div key={i} className="flex gap-3">
            {m.role === "user"
              ? <Avatar name={chat.authorName} size={32} />
              : <AssistantAvatar size={32} />}
            <div className="min-w-0 max-w-[90%] flex-1">
              <div className="mb-1 flex items-center gap-1.5 text-xs opacity-60">
                {m.role === "user" ? <UserIcon size={12} /> : <Bot size={12} />}
                {m.role === "user" ? chat.authorName : "KisAssistant"}
              </div>
              {m.role === "user" ? (
                <div className="whitespace-pre-wrap rounded-3xl rounded-tl-lg border border-stone-200/70 bg-white px-5 py-3 text-[15px] dark:border-zinc-800 dark:bg-zinc-900">{m.content}</div>
              ) : (
                <div className="rounded-3xl rounded-tl-lg border border-stone-200/70 bg-white px-5 py-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                  <Markdown text={m.content} />
                </div>
              )}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}

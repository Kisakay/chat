import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { cn } from "../lib/cn.ts";

/**
 * User message content with attached files folded away.
 *
 * Text/OCR attachments travel inlined in the message as:
 *   [attached text file: foo.txt]
 *   ```text
 *   <whole file content, up to 500KB>
 *   ```
 * Rendering that raw blows the bubble off-screen, so each block renders as
 * a collapsed attachment row (header + expand chevron, no i18n needed) with
 * the body capped to a scrollable pane when expanded.
 */
const ATTACH_RE = /^(\[.*?\])\n```text\n([\s\S]*?)\n```/gm;

function AttachmentBlock({ header, body, tone }: { header: string; body: string; tone: "accent" | "plain" }) {
  const [open, setOpen] = useState(false);
  const label = header.startsWith("[") && header.endsWith("]") ? header.slice(1, -1) : header;
  return (
    <span
      className={cn(
        "mt-2 block overflow-hidden rounded-2xl text-left",
        tone === "accent" ? "bg-black/25 dark:bg-black/30" : "bg-stone-200/70 dark:bg-zinc-800",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-medium"
      >
        <FileText size={14} className="shrink-0 opacity-80" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          size={14}
          className={cn("shrink-0 opacity-80 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <pre
          className={cn(
            "max-h-72 overflow-auto whitespace-pre-wrap break-words border-t px-3 py-2 font-mono text-[12.5px] leading-relaxed",
            tone === "accent" ? "border-white/10" : "border-stone-300/70 dark:border-zinc-700",
          )}
        >
          {body}
        </pre>
      )}
    </span>
  );
}

export function UserMessageContent({ content, tone = "accent" }: { content: string; tone?: "accent" | "plain" }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  ATTACH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTACH_RE.exec(content)) !== null) {
    if (m.index > last) parts.push(<span key={key++}>{content.slice(last, m.index)}</span>);
    parts.push(<AttachmentBlock key={key++} header={m[1]!} body={m[2] ?? ""} tone={tone} />);
    last = m.index + m[0].length;
  }
  if (last < content.length) parts.push(<span key={key++}>{content.slice(last)}</span>);
  if (parts.length === 0) return <>{content}</>;
  return <>{parts}</>;
}

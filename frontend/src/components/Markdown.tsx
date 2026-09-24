import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./ui.tsx";
import { highlightCode } from "../lib/highlight.tsx";

/** Raw source text of a react-markdown <code> element (children may be split). */
export function extractCodeText(children: unknown): string {
  if (children === null || children === undefined) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractCodeText).join("");
  const props = (children as { props?: { children?: unknown } })?.props;
  if (props && typeof props === "object" && "children" in props) return extractCodeText(props.children);
  return "";
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const nodes = useMemo(() => highlightCode(code, lang), [code, lang]);
  return (
    <div className="relative">
      {lang && (
        <span className="absolute left-4 top-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">{lang}</span>
      )}
      <div className="absolute right-2.5 top-2">
        <CopyButton text={code} />
      </div>
      <pre className={lang ? "pt-9" : ""}>
        <code>{nodes}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md space-y-3 text-[15px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre({ children }) {
            // react-markdown nests <code> inside <pre>; render our block instead.
            const child = Array.isArray(children) ? children[0] : children;
            const props = (child as { props?: { className?: string; children?: unknown } })?.props;
            if (!props || typeof props !== "object") return <pre>{children}</pre>;
            const className = typeof props.className === "string" ? props.className : "";
            const lang = className.replace("language-", "");
            const code = extractCodeText(props.children).replace(/\n$/, "");
            return <CodeBlock code={code} lang={lang} />;
          },
          code({ children }) {
            return <code>{children}</code>;
          },
          table({ children }) {
            // Wide tables would blow the bubble off-screen on mobile —
            // scroll them inside their own pane instead.
            return (
              <div className="overflow-x-auto pb-1">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

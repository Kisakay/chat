import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton } from "./ui.tsx";

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="relative">
      {lang && (
        <span className="absolute left-4 top-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400">{lang}</span>
      )}
      <div className="absolute right-2.5 top-2">
        <CopyButton text={code} />
      </div>
      <pre className={lang ? "pt-9" : ""}>
        <code>{code}</code>
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
            const className = props?.className || "";
            const lang = className.replace("language-", "");
            const code = String(props?.children ?? "").replace(/\n$/, "");
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

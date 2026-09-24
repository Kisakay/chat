import type { ReactNode } from "react";

/**
 * Dependency-free syntax highlighting for chat code blocks.
 *
 * No highlight.js / prism (keeps the bundle small and the Nix offline build
 * lockfile-stable): a small regex tokenizer per language family that emits
 * <span> tokens colored for the always-dark <pre> bubble (see index.css).
 * Unknown languages fall back to generic strings/comments/numbers so every
 * block still gets some coloration.
 */

const CLS = {
  comment: "text-stone-400 italic",
  string: "text-amber-200",
  keyword: "text-violet-300",
  number: "text-sky-300",
  function: "text-emerald-300",
  type: "text-rose-300",
  decorator: "text-orange-300",
  diffAdd: "text-emerald-300",
  diffDel: "text-red-300",
} as const;

type TokKind = keyof typeof CLS | "plain";

interface Token {
  kind: TokKind;
  text: string;
}

const ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  py: "python",
  py3: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  terminal: "bash",
  yml: "yaml",
  json5: "json",
  jsonc: "json",
  cxx: "cpp",
  "c++": "cpp",
  hpp: "cpp",
  cs: "csharp",
  rs: "rust",
  golang: "go",
  dockerfile: "docker",
  makefile: "make",
  md: "markdown",
  html: "xml",
  vue: "xml",
  svelte: "xml",
};

const KEYWORDS: Record<string, string[]> = {
  javascript: "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set".split(" "),
  typescript: "break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set interface type enum implements private public protected readonly abstract namespace declare".split(" "),
  python: "and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case".split(" "),
  bash: "if then else elif fi for while in do done case esac function select until echo exit return local export alias cd ls".split(" "),
  rust: "as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while async await dyn".split(" "),
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var".split(" "),
  java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var".split(" "),
  c: "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while".split(" "),
  cpp: "auto break case char const continue default do double else enum extern float for goto if inline int long namespace new private protected public return short signed sizeof static struct switch template this throw try typedef typename union unsigned using virtual void volatile while class constexpr decltype noexcept nullptr static_assert".split(" "),
  csharp: "abstract as base bool break byte case catch char checked class const continue decimal default do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while var".split(" "),
  php: "abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public require require_once return static switch throw trait try unset use var while xor yield".split(" "),
  ruby: "alias and begin BEGIN break case class def defined do else elsif end END ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield".split(" "),
  swift: "associatedtype class deinit enum extension fileprivate func if import in init inout internal let open operator private protocol public static struct subscript typealias var break case continue default defer do else fallthrough for guard repeat return switch where while as catch throw throws try await async".split(" "),
  kotlin: "as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field finally get import init out set value where".split(" "),
  sql: "select from where join left right inner outer on group by order having limit offset insert into values update set delete create table alter drop index view as and or not null primary key foreign references distinct union all exists in between like is asc desc".split(" "),
  json: "true false null".split(" "),
  yaml: "true false null yes no on off".split(" "),
  css: "import media supports keyframes font-face".split(" "),
  xml: [],
  docker: "from run cmd label maintainer expose env add copy entrypoint volume user workdir arg onbuild stopsignal healthcheck shell".split(" "),
  make: "ifeq ifneq else endif include override export unexport define endef".split(" "),
  markdown: [],
};

function langKey(lang: string): string {
  const l = lang.trim().toLowerCase();
  return ALIASES[l] ?? l;
}

function escapeRe(words: string[]): string {
  return words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
}

interface Grammar {
  lineComment?: string;
  blockComment?: boolean;
  strings: ("sq" | "dq" | "bq" | "py3")[];
  keywords: string[];
}

function grammarFor(lang: string): Grammar | null {
  switch (lang) {
    case "javascript":
    case "typescript":
      return { lineComment: "//", blockComment: true, strings: ["sq", "dq", "bq"], keywords: KEYWORDS[lang]! };
    case "json":
      return { strings: ["dq"], keywords: KEYWORDS.json! };
    case "python":
      return { lineComment: "#", strings: ["sq", "dq", "py3"], keywords: KEYWORDS.python! };
    case "bash":
      return { lineComment: "#", strings: ["sq", "dq"], keywords: KEYWORDS.bash! };
    case "rust":
    case "go":
    case "java":
    case "c":
    case "cpp":
    case "csharp":
    case "php":
    case "swift":
    case "kotlin":
      return { lineComment: "//", blockComment: true, strings: ["sq", "dq"], keywords: KEYWORDS[lang]! };
    case "ruby":
      return { lineComment: "#", strings: ["sq", "dq"], keywords: KEYWORDS.ruby! };
    case "sql":
      return { lineComment: "--", blockComment: true, strings: ["sq", "dq"], keywords: KEYWORDS.sql! };
    case "yaml":
      return { lineComment: "#", strings: ["sq", "dq"], keywords: KEYWORDS.yaml! };
    case "css":
      return { blockComment: true, strings: ["sq", "dq"], keywords: KEYWORDS.css! };
    case "xml":
      return { strings: ["sq", "dq"], keywords: [] };
    case "docker":
      return { lineComment: "#", strings: ["sq", "dq"], keywords: KEYWORDS.docker! };
    case "make":
      return { lineComment: "#", strings: [], keywords: KEYWORDS.make! };
    default:
      return null;
  }
}

const STRING_RE: Record<string, string> = {
  sq: "'(?:[^'\\\\\\n]|\\\\.)*'",
  dq: '"(?:[^"\\\\\\n]|\\\\.)*"',
  bq: "`(?:[^`\\\\]|\\\\.)*`",
  py3: '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'',
};

function tokenize(code: string, lang: string): Token[] {
  const lk = langKey(lang);

  // Diffs color whole lines — handled line by line, no grammar needed.
  if (lk === "diff" || lk === "patch") {
    return code.split("\n").flatMap((line, i, arr) => {
      const kind: TokKind =
        line.startsWith("+") && !line.startsWith("+++") ? "diffAdd" : line.startsWith("-") && !line.startsWith("---") ? "diffDel" : line.startsWith("@") ? "function" : "plain";
      const toks: Token[] = [{ kind, text: line }];
      if (i < arr.length - 1) toks.push({ kind: "plain", text: "\n" });
      return toks;
    });
  }

  const g = grammarFor(lk);
  // Unknown language: generic strings + comments + numbers.
  const grammar: Grammar = g ?? { lineComment: "//", blockComment: true, strings: ["sq", "dq"], keywords: [] };

  const commentAlts: string[] = [];
  if (grammar.blockComment) commentAlts.push("/\\*[\\s\\S]*?(?:\\*/|$)");
  if (lk === "xml") commentAlts.push("<!--[\\s\\S]*?(?:-->|$)");
  if (grammar.lineComment) {
    const lc = grammar.lineComment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // `//` must not match the `://` of URLs (https://…).
    commentAlts.push(grammar.lineComment === "//" ? `(?<!:)//[^\\n]*` : `${lc}[^\\n]*`);
  }
  const stringAlts = grammar.strings.map((s) => STRING_RE[s]!);

  const named: [TokKind, string][] = [];
  if (commentAlts.length > 0) named.push(["comment", commentAlts.join("|")]);
  if (stringAlts.length > 0) named.push(["string", stringAlts.join("|")]);
  if (grammar.keywords.length > 0) named.push(["keyword", `\\b(?:${escapeRe(grammar.keywords)})\\b`]);
  named.push(["number", "\\b(?:0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b"]);
  named.push(["decorator", "@[A-Za-z_][\\w$]*"]);
  named.push(["function", "[A-Za-z_][\\w$]*(?=\\s*\\()"]);
  named.push(["type", "\\b[A-Z][A-Za-z0-9_]*\\b"]);

  const re = new RegExp(named.map(([kind, p]) => `(?<${kind}>${p})`).join("|"), "g");
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  // Guard against pathological inputs: cap tokens, dump the rest as plain.
  const MAX_TOKENS = 5000;
  while ((m = re.exec(code)) !== null && tokens.length < MAX_TOKENS) {
    if (m.index > last) tokens.push({ kind: "plain", text: code.slice(last, m.index) });
    const text = m[0];
    const groups = m.groups ?? {};
    const kind: TokKind = (named.find(([k]) => groups[k] !== undefined)?.[0] ?? "plain") as TokKind;
    tokens.push({ kind, text });
    last = m.index + text.length;
    if (text.length === 0) re.lastIndex++;
  }
  if (last < code.length) tokens.push({ kind: "plain", text: code.slice(last) });
  return tokens;
}

export function highlightCode(code: string, lang: string): ReactNode[] {
  const tokens = tokenize(code, lang);
  return tokens.map((t, i) =>
    t.kind === "plain" ? (
      <span key={i}>{t.text}</span>
    ) : (
      <span key={i} className={CLS[t.kind]}>
        {t.text}
      </span>
    ),
  );
}

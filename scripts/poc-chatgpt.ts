/**
 * POC — drive an Arcaic web-UI backend inside a totally temporary Firefox
 * profile (puppeteer-core, WebDriver BiDi, headless by default). The profile
 * is created in /tmp at launch and deleted on exit; login is done manually
 * in the window (with --headed) when the script asks for it.
 *
 * Usage:
 *   bun scripts/poc-chatgpt.ts                          # send default test message (openai site)
 *   bun scripts/poc-chatgpt.ts --site qwen              # openai | qwen | gemini
 *   bun scripts/poc-chatgpt.ts --message "hello"        # custom message (\n supported)
 *   bun scripts/poc-chatgpt.ts --message $'l1\nl2'      # multi-line test
 *   bun scripts/poc-chatgpt.ts --probe                  # just open + report page state
 *   bun scripts/poc-chatgpt.ts --headed                 # visible window (debug / manual login)
 *   bun scripts/poc-chatgpt.ts --timeout-s 600          # longer response timeout
 */
import { ArcaicBrowserEngine, SITES } from "../src/drivers/browser.ts";

const DEFAULT_MESSAGE = "Hello! Answer with one short sentence so we know the pipeline works.";

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

const exe = process.env.ARCAIC_EXECUTABLE ?? "firefox";
const executablePath = exe.includes("/") ? exe : Bun.which(exe);
if (!executablePath) {
  console.error("firefox not found — set ARCAIC_EXECUTABLE to the Firefox binary path");
  process.exit(1);
}

const responseTimeoutS = Number(option("--timeout-s") ?? 300);
if (!Number.isFinite(responseTimeoutS) || responseTimeoutS <= 0) {
  console.error("--timeout-s must be a positive number of seconds");
  process.exit(1);
}

const siteKey = option("--site") ?? "openai";
const site = SITES[siteKey];
if (!site) {
  console.error(`--site must be one of: ${Object.keys(SITES).join(" | ")}`);
  process.exit(1);
}

const engine = new ArcaicBrowserEngine({
  executablePath,
  headless: !flag("--headed"),
  loginTimeoutMs: 600_000,
  responseTimeoutMs: responseTimeoutS * 1000,
});

let interrupted = 0;
process.on("SIGINT", () => {
  interrupted++;
  if (interrupted > 1) process.exit(130);
  console.log("\n[interrupt] closing browser and deleting the temporary profile…");
  void engine.close().finally(() => process.exit(130));
});

const t0 = Date.now();
const step = (msg: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

try {
  if (flag("--probe")) {
    step(`launching Firefox (${executablePath}) with a fresh throwaway profile [site=${site.key}]`);
    const info = await engine.probe(site);
    console.log(JSON.stringify(info, null, 2));
    step(info.composer ? `composer ready: ${info.composer}` : "composer NOT found — login wall or challenge page");
  } else {
    const message = option("--message") ?? DEFAULT_MESSAGE;
    step(`launching Firefox (${executablePath}${flag("--headed") ? ", headed" : ", headless"}) — temporary profile, deleted on exit [site=${site.key}]`);
    let streamed = "";
    const final = await engine.send(message, {
      site,
      onLoginHint: () => step("login required: log in inside the Firefox window (waiting up to 10 min)"),
      onToken: (delta) => {
        streamed += delta;
        process.stdout.write(delta);
      },
    });
    console.log();
    if (!streamed.trim()) console.log(final);
    step(`done — response above (${final.length} chars)`);
  }
  process.exitCode = 0;
} catch (e) {
  console.error(`\n[error] ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await engine.close();
  step("browser closed, temporary profile deleted");
}

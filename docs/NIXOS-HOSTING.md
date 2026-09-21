# Hosting KisAssistant on a NixOS server

End-to-end guide: build the flake, wire the module into `configuration.nix`,
secure it with agenix/sops-nix, and put it behind nginx with automatic TLS.

Contents:

1. [Prerequisites](#1-prerequisites)
2. [Add the flake to your system inputs](#2-add-the-flake-to-your-system-inputs)
3. [Secrets (`APP_PASSWORD`, API keys)](#3-secrets-app_password-api-keys)
4. [Enable the service](#4-enable-the-service)
5. [TLS reverse proxy (`enableNginx`)](#5-tls-reverse-proxy-enablenginx)
6. [First deploy & smoke test](#6-first-deploy--smoke-test)
7. [Operations: logs, backups, updates](#7-operations-logs-backups-updates)
8. [Module option reference](#8-module-option-reference)

---

## 1. Prerequisites

- A NixOS machine (unstable channel or a flake lock close to it) with
  ` networking` + `firewall` under your control.
- Bun is **not** installed on the server — the flake wraps the runtime.
- DNS: an A/AAAA record for your domain (e.g. `chat.kisakay.com`) pointing at
  the server. ACME (Let's Encrypt) needs port 80/443 reachable during
  issuance.
- Ollama reachable from the server (e.g. `http://10.66.66.4:11434` on your
  LAN/tailscale).

## 2. Add the flake to your system inputs

In your system flake (or `flake.nix` of your NixOS config):

```nix
{
  inputs.kisassistant.url = "http://git.kisakay.com/k/chat";  # adjust to real repo path

  outputs = { self, nixpkgs, kisassistant, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        ./configuration.nix
        kisassistant.nixosModules.default
      ];
    };
  };
}
```

If you don't use flakes for your system config, import the module by path:

```nix
imports = [ /etc/nixos/kisassistant/module.nix ];
# and point the package at a build:
services.kisassistant.package =
  (builtins.getFlake "git+http://git.kisakay.com/k/chat").packages.x86_64-linux.default;
```

> The frontend is compiled **offline inside the Nix build** with Bun from
> `frontend/bun.lock` (fixed-output deps fetch). If `nix build` ever fails with
> a `bunDepsHash` mismatch, paste the `got: sha256-…` value from the error into
> `bunDepsHash` in `flake.nix` and rebuild. This is normal after dependency
> bumps.

## 3. Secrets (`APP_PASSWORD`, API keys)

Never put secrets in the Nix store. Use [agenix](https://github.com/ryantm/agenix)
or [sops-nix](https://github.com/Mic92/sops-nix). Minimal agenix setup:

```bash
# on your machine, in the secrets repo of the host
npx agenix generate kisassistant-password -a $(readlink -f /etc/ssh/ssh_host_ed25519_key.pub)
# write the admin key into the file, e.g.:
echo "$(openssl rand -base64 24)" | agenix -e kisassistant-password.age   # keep a copy!
```

Then on the host:

```nix
age.secrets.kisassistant-password.file = /etc/nixos/secrets/kisassistant-password.age;
```

The module consumes it as `passwordFile` and injects it into the service via
systemd `LoadCredential` — the file is read at runtime only.

## 4. Enable the service

```nix
services.kisassistant = {
  enable = true;

  # REQUIRED — the module refuses to evaluate without it.
  package = kisassistant.packages.${pkgs.system}.default;

  # admin key file (agenix/sops-nix path on the host)
  passwordFile = config.age.secrets.kisassistant-password.path;

  # storage (created by systemd StateDirectory, owned by the service user)
  #   SQLite: /var/lib/kisassistant/data
  #   CDN:    /var/lib/kisassistant/cdn
  dataDir = "/var/lib/kisassistant";

  # LLM backends
  ollamaHost = "http://10.66.66.4:11434";
  extraEnv = {
    MISTRAL_ENABLED = "true";  # non-secret toggles only — see the note below
  };
};
```

The module automatically sets for the systemd unit:

| Env | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATA_DIR` | `/var/lib/kisassistant/data` |
| `CDN_DIR` | `/var/lib/kisassistant/cdn` |
| `DRIVER_DEBUG` | `false` |
| `PORT` / `HOST` | `127.0.0.1:3000` (configurable) |

The module also puts `tesseract` on the service `PATH`, so the OCR platform
tool (`POST /api/tools/ocr`, image attachments) works out of the box.
`OCR_LANG` / `OCR_MAX_CHARS` can be overridden via `extraEnv`.

> **API driver keys**: `extraEnv` values land in the unit's `Environment=`,
> which is world-readable in the systemd unit file. For driver API keys prefer
> `EnvironmentFile=` via a drop-in (or pass them from agenix with
> `systemd.services.kisassistant.serviceConfig.EnvironmentFile`), e.g.
> `services.kisassistant.extraEnv = { MISTRAL_ENABLED = "true"; };` plus a
> drop-in containing the key.

### Arcaic backend (`enableBrowserDriver`)

The `arcaic-*` sub-drivers (`arcaic-openai`, `arcaic-gemini`, `arcaic-qwen`)
answer through web-UI sessions: a headless Firefox from the nix store runs
**inside the service** and drives the sites via a browser-automation session
(WebDriver BiDi). Anonymous sessions work — no login needed — and every
browser launch gets a throwaway profile (mkdtemp under `/tmp`, deleted on
exit).

```nix
services.kisassistant = {
  enable = true;
  # …
  enableBrowserDriver = true;   # adds firefox to the service PATH and sets
};                              # ARCAIC_ENABLED/HEADLESS/EXECUTABLE
```

Overridable through `extraEnv` (values win over the module defaults):
`ARCAIC_LOGIN_TIMEOUT_S` (default 300), `ARCAIC_RESPONSE_TIMEOUT_S`
(default 300). The browser only starts on the **first request** that uses one
of the `arcaic-*:chat` models (`arcaic-openai`, `arcaic-gemini`,
`arcaic-qwen`) — boot cost stays zero otherwise.

**Full isolation: run the whole app in a declarative NixOS container.**
The driver launches Firefox as a subprocess, so the browser must live in the
same namespace as the backend — the cleanest isolation is an nspawn
container wrapping the entire service:

```nix
containers.kisassistant = {
  autoStart = true;
  privateNetwork = true;
  hostAddress = "10.99.0.1";
  localAddress = "10.99.0.2";
  config = { config, pkgs, ... }: {
    imports = [ kisassistant.nixosModules.default ];
    services.kisassistant = {
      enable = true;
      package = kisassistant.packages.x86_64-linux.default;
      host = "0.0.0.0";
      enableBrowserDriver = true;
      passwordFile = "/var/lib/kisassistant-password";  # provision inside
    };
  };
};

# Host: nginx proxies to the container (enableNginx stays unset/false)
services.nginx.virtualHosts."chat.kisakay.com" = {
  forceSSL = true;
  enableACME = true;
  locations."/" = {
    proxyPass = "http://10.99.0.2:3000";
    extraConfig = "proxy_buffering off;";
  };
};
```

Headless mode needs no display server anywhere (validated: cookie banner
accepted, message sent, response streamed). If the site ever starts
headless-shaming, fall back to `ARCAIC_HEADLESS=false` inside the
container plus an `Xvfb` service — same driver, virtual display.

## 5. TLS reverse proxy (`enableNginx`)

The conventional switch is `enableNginx` — a tri-state:

| Value | Behaviour |
|---|---|
| `true` | nginx vhost + ACME configured (requires `domain`) |
| `false` | nginx never touched, even if `domain` is set |
| `null` (default) | legacy: nginx configured iff `domain` is set |

```nix
services.kisassistant = {
  enableNginx = true;
  domain = "chat.kisakay.com";   # vhost name + ACME cert name
  # host/port default to 127.0.0.1:3000
};

# Required once per host for ACME (Let's Encrypt ToS):
security.acme.acceptTerms = true;
security.acme.defaults.email = "you@kisakay.com";

# Keep the backend loopback-only and let nginx own 80/443:
networking.firewall.allowedTCPPorts = [ 80 443 ];
```

The generated vhost: `forceSSL`, `enableACME`, `recommendedProxySettings`, and
`proxy_buffering off` on `/` so SSE token streaming (`/api/chat`) is never
buffered.

**Own nginx instead?** Set `enableNginx = false` (or omit `domain`) and write
your own vhost; proxy to `http://127.0.0.1:3000` and remember
`proxy_buffering off;` for `/` (or at least `/api/chat`).

## 6. First deploy & smoke test

```bash
sudo nixos-rebuild switch --flake .#myhost
```

Check the unit and the proxy:

```bash
systemctl status kisassistant
journalctl -u kisassistant -f            # boot log (APP_PASSWORD errors are fatal)

curl -I https://chat.kisakay.com/       # 200 via nginx
curl -s https://chat.kisakay.com/api/models -H "Authorization: Bearer $TOKEN"
```

Log in through the web UI as `admin` with the `APP_PASSWORD` from your secret
file, then create user accounts from the **Accounts** panel (each gets a
one-time `ka_…` key). See `docs/OPERATIONS.md` for account management.

If port 3000 is used by something else on the host, change
`services.kisassistant.port` and the proxy target follows automatically.

## 7. Operations: logs, backups, updates

**Logs** — per-driver debug lines are off in production
(`DRIVER_DEBUG=false`); flip temporarily with:

```bash
sudo systemctl edit kisassistant   # [Service] Environment=DRIVER_DEBUG=true
sudo systemctl restart kisassistant
```

**Backups** — everything is in `/var/lib/kisassistant`:

```bash
# SQLite is in WAL mode; prefer the backup API over raw copies:
sqlite3 /var/lib/kisassistant/data/kisassistant.db ".backup '/backup/kisassistant.db'"
systemctl stop kisassistant && tar -C /var/lib -czf /backup/kisassistant-$(date +%F).tgz kisassistant && systemctl start kisassistant
```

**Updates** — the usual flake flow:

```bash
nix flake update kisassistant          # or update the rev you pin
sudo nixos-rebuild switch --flake .#myhost
sudo nix store gc                      # keep the previous generation around as needed
```

After dependency bumps the first build may fail with a `bunDepsHash` mismatch
— paste the reported hash into `flake.nix` (see section 2).

## 8. Module option reference

| Option | Type / default | Description |
|---|---|---|
| `enable` | bool | the switch |
| `package` | null **(required)** | flake package, e.g. `kisassistant.packages.${pkgs.system}.default` |
| `port` | port, `3000` | backend listen port |
| `host` | str, `127.0.0.1` | backend bind address (keep loopback behind nginx) |
| `dataDir` | str, `/var/lib/kisassistant` | state root (`data/` + `cdn/` live inside) |
| `user` | str, `kisassistant` | system user/group for the service |
| `passwordFile` | null \| path | file containing `APP_PASSWORD` (agenix/sops-nix) |
| `ollamaHost` | str, `http://localhost:11434` | Ollama endpoint |
| `domain` | null \| str | nginx vhost name, required when `enableNginx = true` |
| `enableNginx` | null \| bool, `null` | `true`/`false` force the bundled reverse proxy on/off; `null` = nginx iff `domain` set (legacy) |
| `enableBrowserDriver` | bool, `false` | headless Firefox in the service for the `arcaic` driver ("Arcaic-Technology" model; sets `ARCAIC_ENABLED`/`ARCAIC_HEADLESS`/`ARCAIC_EXECUTABLE`, overridable via `extraEnv`) |
| `extraEnv` | attrs of str, `{}` | extra environment (non-secret values only) |

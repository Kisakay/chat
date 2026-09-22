{ config, lib, pkgs, ... }:
let
  cfg = config.services.kisassistant;

  # Backward-compatible tri-state: null (default) keeps the legacy behaviour
  # (setting `domain` activates nginx), true forces it on, false forces it off.
  nginxEnabled =
    if cfg.enableNginx != null then cfg.enableNginx
    else cfg.domain != null;
in {
  options.services.kisassistant = {
    enable = lib.mkEnableOption "KisAssistant private chat assistant";
    package = lib.mkOption {
      type = lib.types.nullOr lib.types.package;
      default = null;
      description = ''
        KisAssistant package built from this flake, e.g.
        `kisassistant.packages.''${pkgs.system}.default`.
        Required when the service is enabled.
      '';
    };
    port = lib.mkOption { type = lib.types.port; default = 3000; };
    host = lib.mkOption { type = lib.types.str; default = "127.0.0.1"; };
    dataDir = lib.mkOption { type = lib.types.str; default = "/var/lib/kisassistant"; };
    user = lib.mkOption { type = lib.types.str; default = "kisassistant"; };
    passwordFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      description = "File containing APP_PASSWORD (use agenix/sops-nix, never store in the store).";
    };
    ollamaHost = lib.mkOption { type = lib.types.str; default = "http://localhost:11434"; };
    postgresqlUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = ''
        Postgres connection URL (e.g. postgres://user:pass@localhost:5432/kisassistant,
        typically a docker container). Null (default) keeps the local SQLite file.
        Prefer a credential file + extraEnv for secrets in production.
      '';
    };
    domain = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "nginx virtualHost name (e.g. chat.kisakay.com). Required when enableNginx is true.";
    };
    enableNginx = lib.mkOption {
      type = lib.types.nullOr lib.types.bool;
      default = null;
      description = ''
        Reverse-proxy the service through nginx with TLS + ACME.
        - `true`: nginx is configured (requires `domain`).
        - `false`: nginx is never configured, even if `domain` is set.
        - `null` (default): legacy behaviour — nginx is configured iff `domain` is set.
      '';
    };
    enableBrowserDriver = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Enable the Arcaic backend (headless Firefox from the nix store
        running a web-UI session inside the service).
        Sets ARCAIC_ENABLED/ARCAIC_HEADLESS/ARCAIC_EXECUTABLE
        (still overridable via extraEnv).
      '';
    };
    extraEnv = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      description = "Extra env (MISTRAL_API_KEY, DEEPSEEK_ENABLED, …). Prefer files for secrets.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.package != null;
        message = "services.kisassistant.package must be set, e.g. kisassistant.packages.\${pkgs.system}.default";
      }
      {
        assertion = !(nginxEnabled && cfg.domain == null);
        message = "services.kisassistant.enableNginx requires services.kisassistant.domain to be set";
      }
    ];

    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.user;
      home = cfg.dataDir;
      createHome = true;
    };
    users.groups.${cfg.user} = {};

    systemd.services.kisassistant = {
      description = "KisAssistant";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        PORT = toString cfg.port;
        HOST = cfg.host;
        NODE_ENV = "production";
        DATA_DIR = "${cfg.dataDir}/data";
        CDN_DIR = "${cfg.dataDir}/cdn";
        DRIVER_DEBUG = "false";
        OLLAMA_HOST = cfg.ollamaHost;
      } // lib.optionalAttrs (cfg.postgresqlUrl != null) {
        POSTGRESQL_URL = cfg.postgresqlUrl;
      } // lib.optionalAttrs cfg.enableBrowserDriver {
        ARCAIC_ENABLED = "true";
        ARCAIC_HEADLESS = "true";
        ARCAIC_EXECUTABLE = "${pkgs.firefox}/bin/firefox";
      } // cfg.extraEnv;
      serviceConfig = {
        User = cfg.user;
        Group = cfg.user;
        Restart = "always";
        StateDirectory = "kisassistant";
        WorkingDirectory = cfg.dataDir;
      } // lib.optionalAttrs (cfg.passwordFile != null) {
        LoadCredential = "app-password:${cfg.passwordFile}";
      };
      # tesseract binary for the OCR platform tool (see TESSERACT_BIN);
      # firefox for the Arcaic backend (enableBrowserDriver).
      path = [ pkgs.tesseract ] ++ lib.optionals cfg.enableBrowserDriver [ pkgs.firefox ];
      script = ''
        ${lib.optionalString (cfg.passwordFile != null) ''
          export APP_PASSWORD="$(cat "$CREDENTIALS_DIRECTORY/app-password")"
        ''}
        exec ${cfg.package}/bin/kisassistant
      '';
    };

    services.nginx = lib.mkIf nginxEnabled {
      enable = true;
      recommendedProxySettings = true;
      virtualHosts.${cfg.domain} = {
        forceSSL = true;
        enableACME = true;
        locations."/" = {
          proxyPass = "http://${cfg.host}:${toString cfg.port}";
          # Never buffer SSE (/api/chat streams tokens like ChatGPT).
          extraConfig = "proxy_buffering off;";
        };
      };
    };
  };
}

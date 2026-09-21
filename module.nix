{ config, lib, pkgs, ... }:
let
  cfg = config.services.kisassistant;
in {
  options.services.kisassistant = {
    enable = lib.mkEnableOption "KisAssistant private chat assistant";
    package = lib.mkOption {
      type = lib.types.package;
      default = pkgs.bun;
      description = "KisAssistant package built from this flake (set via nixpkgs overlay or flake packages output).";
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
    domain = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "e.g. chat.kisakay.com — enables bundled nginx reverse proxy.";
    };
    extraEnv = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = {};
      description = "Extra env (MISTRAL_API_KEY, DEEPSEEK_ENABLED, …). Prefer files for secrets.";
    };
  };

  config = lib.mkIf cfg.enable {
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
        DATA_DIR = "${cfg.dataDir}/data";
        OLLAMA_HOST = cfg.ollamaHost;
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
      script = ''
        ${lib.optionalString (cfg.passwordFile != null) ''
          export APP_PASSWORD="$(cat "$CREDENTIALS_DIRECTORY/app-password")"
        ''}
        exec ${cfg.package}/bin/kisassistant
      '';
    };

    services.nginx = lib.mkIf (cfg.domain != null) {
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

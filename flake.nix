{
  description = "KisAssistant — private chat assistant (Bun backend + React frontend, SQLite)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }: {
    nixosModules.default = import ./module.nix;
    packages.x86_64-linux.default =
      let
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        # Frontend: built offline from the npm lockfile. If the build fails
        # with a hash mismatch, replace npmDepsHash with the suggested one.
        frontend = pkgs.buildNpmPackage {
          pname = "kisassistant-frontend";
          version = "0.2.0";
          src = ./frontend;
          npmDepsHash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
          npmBuildScript = "build";
          installPhase = ''
            mkdir -p $out
            cp -r dist/* $out/
          '';
        };
      in pkgs.stdenv.mkDerivation {
        pname = "kisassistant";
        version = "0.2.0";
        src = ./.;
        nativeBuildInputs = [ pkgs.bun ];
        buildPhase = ''
          export HOME=$TMPDIR
          # Backend has zero runtime deps; install only for @types/bun (typecheck).
          bun install --frozen-lockfile 2>/dev/null || bun install --no-save || true
        '';
        installPhase = ''
          mkdir -p $out/share/kisassistant
          cp -r src package.json tsconfig.json .env.example $out/share/kisassistant/
          cp -r ${frontend} $out/share/kisassistant/public
          mkdir -p $out/bin
          cat > $out/bin/kisassistant <<EOF
          #!${pkgs.bash}/bin/bash
          cd $out/share/kisassistant
          exec ${pkgs.bun}/bin/bun run src/index.ts
          EOF
          chmod +x $out/bin/kisassistant
        '';
      };
  };
}

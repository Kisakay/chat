{
  description = "KisAssistant — private chat assistant (Bun backend + React frontend, SQLite)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let lib = nixpkgs.lib; in {
    nixosModules.default = import ./module.nix;
    packages.x86_64-linux.default =
      let
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        version = "0.2.0";

        # Frontend: two-phase bun build.
        # Phase 1 (fixed-output, has network): populate node_modules from
        # frontend/bun.lock. If the build fails with a hash mismatch, paste
        # the "got: sha256-…" value into bunDepsHash below.
        bunDeps = pkgs.stdenv.mkDerivation {
          pname = "kisassistant-frontend-bun-deps";
          inherit version;
          src = ./frontend;
          nativeBuildInputs = [ pkgs.bun ];
          buildPhase = ''
            export HOME=$TMPDIR
            export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
            bun install --frozen-lockfile --ignore-scripts
          '';
          installPhase = ''
            cp -r node_modules $out
          '';
          outputHashAlgo = "sha256";
          outputHashMode = "recursive";
          outputHash = "sha256-ToEgXq9TpyliuZn+0bu+95SUER+tuXLJ0LHY+c6LUXE=";
        };

        # Phase 2 (offline): vite build against the pre-fetched node_modules.
        frontend = pkgs.stdenv.mkDerivation {
          pname = "kisassistant-frontend";
          inherit version;
          src = ./frontend;
          nativeBuildInputs = [ pkgs.bun pkgs.nodejs ];
          buildPhase = ''
            export HOME=$TMPDIR
            cp -a ${bunDeps} node_modules
            chmod -R u+w node_modules
            patchShebangs node_modules
            bun run build
          '';
          installPhase = ''
            mkdir -p $out
            cp -r ../public/. $out/
          '';
        };
      in pkgs.stdenv.mkDerivation {
        pname = "kisassistant";
        inherit version;
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

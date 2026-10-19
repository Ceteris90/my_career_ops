{
  description = "career-ops - AI job search pipeline";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flakelight.url = "github:nix-community/flakelight";
  };

  outputs =
    { flakelight, nixpkgs, ... }:
    flakelight ./. {

      inputs.nixpkgs = nixpkgs;

      # flakelight only exposes its default Linux systems unless `systems` is
      # set, so on macOS `nix develop` / direnv fail with a confusing
      # "does not provide attribute 'devShells.aarch64-darwin.default'" error.
      # List the common dev systems so the devShell resolves on macOS too.
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      devShell.packages =
        pkgs: with pkgs; [

          nodejs
          bun

          coreutils

          playwright-driver.browsers

          # Playwright MCP server, built against the same nixpkgs browsers. The
          # npm `@playwright/mcp` bundles its own Playwright and looks for a
          # browser revision this shell does not have. Point the MCP config at
          # `mcp-server-playwright` instead (docs/NIXOS.md).
          playwright-mcp

          # pdftotext / pdftoppm, for reading a PDF CV during onboarding.
          poppler-utils

        ];

      # No PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: the nixpkgs browsers are
      # patched, so host validation passes on its own, and with the variable
      # set Playwright writes a notice to stderr on every launch.
      # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD also makes the package.json postinstall
      # skip `playwright install`, which cannot write to the Nix store.
      devShell.env = pkgs: {
        PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
      };

      # nixpkgs builds one Playwright browser revision, and each npm Playwright
      # release looks for exactly one revision, so the npm package must match
      # playwright-driver. package.json pins a newer one, and every
      # `npm install` puts it back, so the pin runs on every shell entry.
      # After `npm install`, re-enter the shell (`direnv reload`, or exit and
      # `nix develop` again).
      devShell.shellHook = pkgs: ''
        EXPECTED="${pkgs.playwright-driver.version}"
        CURRENT=$(node -e "try{console.log(require('playwright-core/package.json').version)}catch{}" 2>/dev/null)
        if [ "$CURRENT" != "$EXPECTED" ]; then
          echo "Pinning playwright to $EXPECTED to match Nix-provided browsers..."
          if ! npm install --no-save --ignore-scripts --no-audit --no-fund "playwright@$EXPECTED" >/dev/null; then
            echo "warning: could not pin playwright@$EXPECTED; browser launches will fail until it is pinned." >&2
          fi
        fi
      '';

    };

}

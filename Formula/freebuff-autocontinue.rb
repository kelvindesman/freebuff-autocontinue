class FreebuffAutocontinue < Formula
  desc "Autonomous session supervisor for Freebuff CLI with smart model fallback"
  homepage "https://github.com/kelvindesman/freebuff-autocontinue"
  # NOTE: the tag-driven release workflow patches `url` + `sha256` on every
  # version tag. The placeholder below is only for local `brew install --build-from-source` checks.
  url "https://github.com/kelvindesman/freebuff-autocontinue/releases/download/v0.3.0/freebuff-autocontinue-v0.3.0.tar.gz"
  sha256 "17a91b3e078a31551377fcd2fd402d83f24bbaca0086e5556752a3d5de7c9f5d"
  license "MIT"
  head "https://github.com/kelvindesman/freebuff-autocontinue.git", branch: "main"

  livecheck do
    url :stable
    strategy :github_latest
  end

  depends_on "node"
  depends_on "tmux"

  def install
    # NOTE: `brew audit` suggests `std_npm_args`, but that API does not exist
    # in Homebrew <= 7.0.7 (including this machine). Revisit on core feedback.
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)

    # Homebrew's npm install omits devDependencies, but the build needs them
    # (esbuild). Install them deterministically from the committed lockfile,
    # copied from the source tree (`files` deliberately excludes it from the
    # published npm tarball), then build explicitly.
    pkgdir = libexec/"lib/node_modules/freebuff-autocontinue"
    cp buildpath/"package-lock.json", pkgdir/"package-lock.json"
    system "npm", "ci", "--prefix=#{pkgdir}", "--no-audit", "--no-fund",
           "--ignore-scripts"

    # `npm install` honors the `files` whitelist, so `src/` never lands in
    # libexec. Build from the extracted source (buildpath) into the installed
    # package dir, with absolute paths (no cwd dependence).
    # (`npm ci` above installs node_modules inside pkgdir.)
    esbuild = pkgdir/"node_modules/.bin/esbuild"
    system esbuild, "#{buildpath}/src/cli.ts", "--bundle", "--platform=node",
           "--format=esm", "--outfile=#{pkgdir}/dist/cli.js"
    system esbuild, "#{buildpath}/src/index.ts", "--bundle", "--platform=node",
           "--format=esm", "--outfile=#{pkgdir}/dist/index.js"
    chmod "+x", pkgdir/"dist/cli.js"
    bin.install_symlink pkgdir/"dist/cli.js" => "freebuff-autocontinue"
  end

  test do
    assert_match "freebuff-autocontinue v", shell_output("#{bin}/freebuff-autocontinue --version")
    assert_match "Self-test finished: 0 failures", shell_output("#{bin}/freebuff-autocontinue --self-test")
  end
end

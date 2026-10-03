require "json"

class FreebuffAutocontinue < Formula
  desc "Autonomous session supervisor for Freebuff CLI with smart model fallback"
  homepage "https://github.com/kelvindesman/freebuff-autocontinue"
  # NOTE: the tag-driven release workflow patches `url` + `sha256` on every
  # version tag. The placeholder below is only for local `brew install --build-from-source` checks.
  url "https://github.com/kelvindesman/freebuff-autocontinue/releases/download/v0.1.7/freebuff-autocontinue-v0.1.7.tar.gz"
  sha256 "618fefdeaec9dff6aa93e002efb87e4a7790372bf24aec82c10e93771d148645"
  license "MIT"
  head "https://github.com/kelvindesman/freebuff-autocontinue.git", branch: "main"

  depends_on "node"
  depends_on "tmux"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)

    # Homebrew's npm install omits devDependencies, but the `prepare` build
    # needs them (esbuild). Install pinned build tools from package.json,
    # then build explicitly. Versions are read from package.json so they
    # can never drift.
    pkg = JSON.parse((buildpath/"package.json").read)
    # Keep the semver ranges from package.json (npm resolves them); stripping
    # `^` would pin nonexistent exact versions (e.g. typescript has no 5.6.0).
    build_tools = pkg.fetch("devDependencies", {}).map do |name, ver|
      "#{name}@#{ver}"
    end
    system "npm", "install", "--prefix=#{libexec}", "--no-save",
           "--no-audit", "--no-fund", *build_tools

    # `npm install` honors the `files` whitelist, so `src/` never lands in
    # libexec. Build from the extracted source (buildpath) into the installed
    # package dir, with absolute paths (no cwd dependence).
    pkgdir = libexec/"lib/node_modules/freebuff-autocontinue"
    esbuild = libexec/"node_modules/.bin/esbuild"
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

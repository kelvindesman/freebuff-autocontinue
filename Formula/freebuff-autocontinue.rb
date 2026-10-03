require "json"

class FreebuffAutocontinue < Formula
  desc "Autonomous session supervisor for Freebuff CLI with smart model fallback"
  homepage "https://github.com/kelvindesman/freebuff-autocontinue"
  # NOTE: the tag-driven release workflow patches `url` + `sha256` on every
  # version tag. The placeholder below is only for local `brew install --build-from-source` checks.
  url "https://github.com/kelvindesman/freebuff-autocontinue/archive/refs/tags/v0.1.3.tar.gz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
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
    build_tools = pkg.fetch("devDependencies", {}).map do |name, ver|
      "#{name}@#{ver.delete_prefix("^").delete_prefix("~")}"
    end
    system "npm", "install", "--prefix=#{libexec}", "--no-save",
           "--no-audit", "--no-fund", *build_tools

    cd libexec/"lib/node_modules/freebuff-autocontinue" do
      system "npm", "run", "build"
    end
    bin.install_symlink libexec/"lib/node_modules/freebuff-autocontinue/dist/cli.js" => "freebuff-autocontinue"
  end

  test do
    assert_match "freebuff-autocontinue v", shell_output("#{bin}/freebuff-autocontinue --version")
    assert_match "Self-test finished: 0 failures", shell_output("#{bin}/freebuff-autocontinue --self-test")
  end
end

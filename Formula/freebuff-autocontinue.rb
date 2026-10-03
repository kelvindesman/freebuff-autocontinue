class FreebuffAutocontinue < Formula
  desc "Autonomous session supervisor for Freebuff CLI with smart model fallback"
  homepage "https://github.com/kelvindesman/freebuff-autocontinue"
  # NOTE: the tag-driven release workflow patches `url` + `sha256` on every
  # version tag. The placeholder below is only for local `brew install --build-from-source` checks.
  url "https://github.com/kelvindesman/freebuff-autocontinue/archive/refs/tags/v0.1.3.tar.gz"
  sha256 "ff76372a987d5e0622b2a8bc73a56dd4ff4da3a569861db5e6870156d8a4ac66"
  license "MIT"
  head "https://github.com/kelvindesman/freebuff-autocontinue.git", branch: "main"

  depends_on "node"
  depends_on "tmux"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink libexec/"dist/cli.js" => "freebuff-autocontinue"
  end

  test do
    assert_match "freebuff-autocontinue v", shell_output("#{bin}/freebuff-autocontinue --version")
    assert_match "Self-test finished: 0 failures", shell_output("#{bin}/freebuff-autocontinue --self-test")
  end
end

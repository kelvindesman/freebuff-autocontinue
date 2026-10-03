import { describe, expect, it } from "bun:test";
import { extractStatus } from "../src/classifier.js";

describe("extractStatus", () => {
  it("extracts working state and elapsed duration", () => {
    const pane = "agent is working...\nworking... 14m 20s ■ Esc";
    const status = extractStatus(pane);
    expect(status.isWorking).toBe(true);
    expect(status.elapsed).toBe("14m 20s");
  });

  it("extracts model name and access tier badge", () => {
    const pane =
      "  DeepSeek V4.1 Flash • UNLIMITED (5 Freebucks/hr)\nworking... 2m ■ Esc";
    const status = extractStatus(pane);
    expect(status.model).toContain("DeepSeek V4.1 Flash");
  });

  it("extracts Freebucks balance meter", () => {
    const pane = "0/105 Freebucks remaining · 2 sessions left today";
    const status = extractStatus(pane);
    expect(status.balance).toBeDefined();
    expect(status.balance?.used).toBe(0);
    expect(status.balance?.total).toBe(105);
  });

  it("extracts active command or tool execution step", () => {
    const pane = "working... 5s ■ Esc\n$ bun test tests/auth.test.ts\n• Thinking";
    const status = extractStatus(pane);
    expect(status.activeStep).toBe("• Thinking");

    const pane2 = "working... 5s ■ Esc\n$ git push origin main";
    const status2 = extractStatus(pane2);
    expect(status2.activeStep).toBe("$ git push origin main");
  });
});

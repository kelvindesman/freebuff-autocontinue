import { beforeEach, describe, expect, it } from "bun:test";
import {
  formatCommunityBanner,
  getNextCommunityMessage,
  resetCommunityMessageIndex,
} from "../src/community.js";
import { COMMUNITY_MESSAGES } from "../src/constants.js";

describe("community", () => {
  beforeEach(() => {
    resetCommunityMessageIndex();
  });

  it("rotates community support messages in order", () => {
    const msg1 = getNextCommunityMessage();
    expect(msg1).toContain("buymeacoffee.com/kelvindsmn");

    const msg2 = getNextCommunityMessage();
    expect(msg2).toContain("Star the repo");

    const msg3 = getNextCommunityMessage();
    expect(msg3).toContain("Paid ads");

    const msg4 = getNextCommunityMessage();
    expect(msg4).toContain("Discord");

    // Cycles back
    const msg5 = getNextCommunityMessage();
    expect(msg5).toBe(COMMUNITY_MESSAGES[0]);
  });

  it("formats community banner with prefix", () => {
    const banner = formatCommunityBanner("Support the author");
    expect(banner).toBe("[community] Support the author");
  });
});

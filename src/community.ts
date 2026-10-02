/**
 * Community and support ticker notifications.
 */

import { COMMUNITY_MESSAGES } from "./constants.js";

let messageIndex = 0;

export function getNextCommunityMessage(): string {
  const msg = COMMUNITY_MESSAGES[messageIndex % COMMUNITY_MESSAGES.length];
  messageIndex++;
  return msg;
}

export function resetCommunityMessageIndex(): void {
  messageIndex = 0;
}

export function formatCommunityBanner(message: string): string {
  return `[community] ${message}`;
}

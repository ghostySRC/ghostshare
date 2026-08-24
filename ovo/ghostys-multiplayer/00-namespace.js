(function (root) {
  "use strict";
  root.GMPInternal = root.GMPInternal || {};
  Object.assign(root.GMPInternal, {
    CLIENT_VERSION: "0.2.0-alpha.2",
    PROTOCOL_VERSION: 2,
    STORAGE_KEYS: {
      playerId: "gmp.playerId",
      resumeToken: "gmp.resumeToken",
      username: "gmp.username",
      settings: "gmp.settings",
      friendCode: "gmp.friendCode",
      friends: "gmp.friends"
    },
    clamp(value, min, max) {
      return Math.max(min, Math.min(max, value));
    },
    randomId() {
      if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
      }
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
    },
    safeJsonParse(value, fallback = null) {
      try {
        return JSON.parse(value);
      } catch (_) {
        return fallback;
      }
    }
  });
})(globalThis);

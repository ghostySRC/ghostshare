(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  if (root.ghostysMultiplayer && root.ghostysMultiplayer.destroy) {
    root.ghostysMultiplayer.destroy();
  }

  function getGameVersion() {
    const match = location.pathname.match(/\/(1\.\d+(?:\.\d+)?)\/?/);
    if (match) return match[1];
    try {
      if (root.VERSION && typeof root.VERSION.version === "function") return String(root.VERSION.version());
    } catch (_) {}
    return "unknown";
  }

  function boot() {
    if (document.getElementById("ovo-multiplayer-toggle-button")) {
      const message = "The old OvO Multiplayer mod is still enabled. Disable it and reload before starting Ghosty's Multiplayer.";
      console.warn("[GMP] " + message);
      alert(message);
      return;
    }
    if (typeof root.cr_getC2Runtime !== "function") return setTimeout(boot, 100);
    const runtime = root.cr_getC2Runtime();
    if (!runtime || runtime.isloading || !runtime.running_layout) return setTimeout(boot, 100);

    const version = getGameVersion();
    if (version !== "1.4.4") {
      alert(`Ghosty's Multiplayer ${ns.CLIENT_VERSION}: ${version} is not supported yet. v0.1 currently targets OvO 1.4.4.`);
      return;
    }

    try {
      root.ghostysMultiplayer = new ns.GhostysMultiplayerApp(runtime, version);
      console.log(`[GMP] Ghosty's Multiplayer ${ns.CLIENT_VERSION} loaded for OvO ${version}`);
    } catch (error) {
      console.error("[GMP] Failed to start", error);
      alert(`Ghosty's Multiplayer failed to start: ${error.message}`);
    }
  }

  boot();
})(globalThis);

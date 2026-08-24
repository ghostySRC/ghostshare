(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  const bootGeneration = (root.__gmpBootGeneration || 0) + 1;
  root.__gmpBootGeneration = bootGeneration;
  if (root.ghostysMultiplayer && root.ghostysMultiplayer.destroy) {
    const previousApp = root.ghostysMultiplayer;
    previousApp.destroy();
    try { previousApp.runtime?.untickMe(previousApp); } catch (_) {}
    root.ghostysMultiplayer = null;
  }

  function getGameVersion() {
    const match = location.pathname.match(/\/(1\.\d+(?:\.\d+)?)\/?/);
    if (match) return match[1];
    try {
      if (root.VERSION && typeof root.VERSION.version === "function") return String(root.VERSION.version());
    } catch (_) {}
    return "unknown";
  }

  function disableOldMultiplayerIfNeeded() {
    try {
      const settings = JSON.parse(localStorage.getItem("modSettings"));
      if (settings && settings.mods && settings.mods.multiplayer && settings.mods.multiplayer.enabled === true) {
        settings.mods.multiplayer.enabled = false;
        localStorage.setItem("modSettings", JSON.stringify(settings));
        sessionStorage.setItem("gmp.disabledLegacyMultiplayer", "1");
        location.reload();
        return true;
      }
    } catch (error) {
      console.warn("[GMP] Could not inspect legacy Multiplayer setting", error);
    }
    return false;
  }

  function boot() {
    if (root.__gmpBootGeneration !== bootGeneration) return;
    if (disableOldMultiplayerIfNeeded()) return;
    if (document.getElementById("ovo-multiplayer-toggle-button")) {
      if (!sessionStorage.getItem("gmp.legacyReloadAttempted")) {
        sessionStorage.setItem("gmp.legacyReloadAttempted", "1");
        location.reload();
        return;
      }
      const message = "The old OvO Multiplayer mod is still active. Disable it in the Modloader and reload.";
      console.warn("[GMP] " + message);
      alert(message);
      return;
    }
    sessionStorage.removeItem("gmp.legacyReloadAttempted");
    if (typeof root.cr_getC2Runtime !== "function") return setTimeout(boot, 100);
    const runtime = root.cr_getC2Runtime();
    if (!runtime || runtime.isloading || !runtime.running_layout) return setTimeout(boot, 100);

    const version = getGameVersion();
    if (version !== "1.4.4") {
      alert(`Ghosty's Multiplayer ${ns.CLIENT_VERSION}: ${version} is not supported yet. This build targets OvO 1.4.4.`);
      return;
    }

    try {
      if (root.ghostysMultiplayer && root.ghostysMultiplayer.destroy) {
        root.ghostysMultiplayer.destroy();
      }
      root.ghostysMultiplayer = new ns.GhostysMultiplayerApp(runtime, version);
      console.log(`[GMP] Ghosty's Multiplayer ${ns.CLIENT_VERSION} loaded for OvO ${version}`);
    } catch (error) {
      console.error("[GMP] Failed to start", error);
      alert(`Ghosty's Multiplayer failed to start: ${error.message}`);
    }
  }

  boot();
})(globalThis);

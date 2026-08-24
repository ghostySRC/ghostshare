(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  const bootGeneration = (root.__gmpBootGeneration || 0) + 1;
  root.__gmpBootGeneration = bootGeneration;

  function cleanPreviousRemoteVisuals(app) {
    const adapter = app && app.adapter;
    if (!adapter || !adapter.runtime) return;
    for (const remote of adapter.remoteInstances && adapter.remoteInstances.values() || []) {
      const subjects = [remote.instance, ...(remote.instance && remote.instance.siblings || [])];
      for (const subject of subjects) {
        for (const behavior of subject && subject.behaviorSkins || []) {
          try {
            if (typeof behavior.destroy === "function") behavior.destroy();
            else if (behavior.object) adapter.runtime.DestroyInstance(behavior.object);
            behavior.object = null;
          } catch (_) {}
        }
      }
      for (const label of remote.labels || []) {
        try { adapter.runtime.DestroyInstance(label); } catch (_) {}
      }
    }
  }

  function cleanOrphanedSkinObjects(runtime) {
    const skinTypes = new Set();
    for (const core of Object.values(root.cr && root.cr.SkymenSkinCore || {})) {
      for (const skin of Object.values(core && core.skins || {})) {
        for (const subskin of Object.values(skin || {})) {
          if (subskin && subskin.type) skinTypes.add(subskin.type);
        }
      }
    }
    if (!skinTypes.size) return;

    const referenced = new Set();
    const remember = (object) => {
      if (!object || referenced.has(object)) return;
      referenced.add(object);
      for (const behavior of object.behaviorSkins || []) remember(behavior && behavior.object);
    };
    for (const type of runtime.types_by_index || []) {
      for (const instance of type.instances || []) {
        for (const behavior of instance.behaviorSkins || []) remember(behavior && behavior.object);
      }
    }

    for (const type of skinTypes) {
      for (const instance of Array.from(type.instances || [])) {
        if (referenced.has(instance) || instance.collisionsEnabled !== false) continue;
        try { runtime.DestroyInstance(instance); } catch (_) {}
      }
    }
  }

  if (root.ghostysMultiplayer && root.ghostysMultiplayer.destroy) {
    const previousApp = root.ghostysMultiplayer;
    cleanPreviousRemoteVisuals(previousApp);
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
    cleanOrphanedSkinObjects(runtime);

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

(() => {
  "use strict";

  const GLOBAL_KEY = "__ghostyOvoFpsUnlocker";
  const DEFAULT_FPS = 240;
  const MAX_WAIT_MS = 20000;
  const OVERLAY_ID = "ghosty-ovo-fps-diagnostic";

  function getOverlay() {
    return document.getElementById(OVERLAY_ID);
  }

  function makeOverlay() {
    let el = getOverlay();
    if (el) return el;

    el = document.createElement("div");
    el.id = OVERLAY_ID;
    Object.assign(el.style, {
      position: "fixed",
      left: "8px",
      bottom: "8px",
      zIndex: "2147483647",
      padding: "7px 10px",
      background: "rgba(255,255,255,.96)",
      color: "#000",
      border: "2px solid #000",
      borderRadius: "3px",
      font: "bold 12px monospace",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      boxShadow: "0 2px 8px rgba(0,0,0,.25)"
    });

    const mount = () => {
      if (el.isConnected) return;
      (document.body || document.documentElement).appendChild(el);
    };

    if (document.body || document.documentElement) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });

    return el;
  }

  function setOverlayText(text) {
    const el = makeOverlay();
    el.textContent = text;
  }

  // This happens BEFORE touching Construct. If this text is not visible,
  // the browser/mod loader never executed this file at all.
  setOverlayText("OvO FPS UNLOCKER: JS LOADED — finding Construct runtime...");

  if (globalThis[GLOBAL_KEY] && globalThis[GLOBAL_KEY].installed) {
    const old = globalThis[GLOBAL_KEY];
    try {
      old.setFPS(DEFAULT_FPS);
      old.start();
      if (typeof old.showOverlay === "function") old.showOverlay();
      setOverlayText(`OvO FPS UNLOCKER: already active — target ${DEFAULT_FPS}`);
    } catch (err) {
      setOverlayText(`OvO FPS UNLOCKER ERROR: ${err && err.message ? err.message : err}`);
    }
    return;
  }

  const state = {
    installed: false,
    running: false,
    targetFPS: DEFAULT_FPS,
    runtime: null,
    lastError: null,
    engineTPS: 0,
    displayFPS: 0,
    setFPS: () => {},
    start: () => {},
    stop: () => {},
    restore: () => {},
    showOverlay: () => makeOverlay(),
    hideOverlay: () => {
      const el = getOverlay();
      if (el) el.remove();
    },
    info: () => ({ installed: false, running: false, targetFPS: DEFAULT_FPS })
  };

  globalThis[GLOBAL_KEY] = state;
  globalThis.ovoFPS = state;

  function resolveRuntime() {
    try {
      if (typeof globalThis.cr_getC2Runtime === "function") {
        const rt = globalThis.cr_getC2Runtime();
        if (rt && typeof rt.tick === "function") return rt;
      }
    } catch (_) {}

    try {
      if (typeof globalThis.c2_callFunction === "function") {
        const key = "__ghostyOvoFpsRuntime";
        const hadOld = Object.prototype.hasOwnProperty.call(globalThis, key);
        const old = globalThis[key];

        globalThis.c2_callFunction("execCode", [`globalThis.${key} = this.runtime`]);
        const rt = globalThis[key];

        if (hadOld) globalThis[key] = old;
        else delete globalThis[key];

        if (rt && typeof rt.tick === "function") return rt;
      }
    } catch (_) {}

    try {
      const canvas = document.getElementById("c2canvas");
      const rt = canvas && canvas.c2runtime;
      if (rt && typeof rt.tick === "function") return rt;
    } catch (_) {}

    return null;
  }

  function install(runtime) {
    if (state.installed) return;

    const originalTick = runtime.tick;
    const cancelFrame =
      globalThis.cancelAnimationFrame ||
      globalThis.webkitCancelAnimationFrame ||
      globalThis.mozCancelAnimationFrame ||
      null;

    let timerId = null;
    let inTick = false;
    let nextTickAt = performance.now();
    let engineFrames = 0;
    let engineWindowStart = performance.now();
    let displayFrames = 0;
    let displayWindowStart = performance.now();
    let overlayTimer = null;

    function clearCustomTimer() {
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
    }

    function cancelConstructSchedule() {
      try {
        if (runtime.raf_id !== undefined && runtime.raf_id !== -1 && cancelFrame) {
          cancelFrame.call(globalThis, runtime.raf_id);
          runtime.raf_id = -1;
        }
      } catch (_) {}

      try {
        if (runtime.timeout_id !== undefined && runtime.timeout_id !== -1) {
          clearTimeout(runtime.timeout_id);
          runtime.timeout_id = -1;
        }
      } catch (_) {}
    }

    function sampleEngineTPS(now) {
      engineFrames++;
      const elapsed = now - engineWindowStart;
      if (elapsed >= 500) {
        state.engineTPS = Math.round((engineFrames * 1000) / elapsed);
        engineFrames = 0;
        engineWindowStart = now;
      }
    }

    function displayCounter(now) {
      displayFrames++;
      const elapsed = now - displayWindowStart;
      if (elapsed >= 500) {
        state.displayFPS = Math.round((displayFrames * 1000) / elapsed);
        displayFrames = 0;
        displayWindowStart = now;
      }
      requestAnimationFrame(displayCounter);
    }

    function updateOverlay() {
      const engine = state.engineTPS || "...";
      const display = state.displayFPS || "...";
      setOverlayText(`OvO UNLOCKER ON | ENGINE ${engine} TPS | DISPLAY ${display} FPS | TARGET ${state.targetFPS}`);
    }

    state.showOverlay = () => {
      makeOverlay();
      updateOverlay();
      if (overlayTimer === null) overlayTimer = setInterval(updateOverlay, 200);
    };

    state.hideOverlay = () => {
      const el = getOverlay();
      if (el) el.remove();
      if (overlayTimer !== null) {
        clearInterval(overlayTimer);
        overlayTimer = null;
      }
    };

    function scheduleNext() {
      if (!state.running) return;

      if (runtime.isSuspended || document.hidden) {
        clearCustomTimer();
        timerId = setTimeout(scheduleNext, 100);
        return;
      }

      const interval = 1000 / state.targetFPS;
      const now = performance.now();

      if (!Number.isFinite(nextTickAt) || nextTickAt < now - interval * 4) {
        nextTickAt = now;
      }

      nextTickAt += interval;
      const delay = Math.max(0, nextTickAt - performance.now());
      clearCustomTimer();
      timerId = setTimeout(runUnlockedTick, delay);
    }

    function runUnlockedTick(timestamp) {
      timerId = null;
      if (!state.running) return;

      if (runtime.isSuspended || document.hidden) {
        scheduleNext();
        return;
      }

      if (inTick) {
        scheduleNext();
        return;
      }

      inTick = true;
      const now = Number.isFinite(timestamp) ? timestamp : performance.now();

      try {
        originalTick.call(runtime, false, now, false);
        sampleEngineTPS(performance.now());
        cancelConstructSchedule();
      } catch (err) {
        state.lastError = err;
        setOverlayText(`OvO FPS UNLOCKER TICK ERROR: ${err && err.message ? err.message : err}`);
        state.stop();
        return;
      } finally {
        inTick = false;
      }

      scheduleNext();
    }

    function patchedTick(backgroundWake, timestamp, debugStep) {
      if (backgroundWake || debugStep) {
        return originalTick.call(runtime, backgroundWake, timestamp, debugStep);
      }

      clearCustomTimer();
      nextTickAt = performance.now();
      runUnlockedTick(Number.isFinite(timestamp) ? timestamp : performance.now());
    }

    state.runtime = runtime;
    state.installed = true;
    state.running = true;

    state.setFPS = (fps) => {
      const n = Number(fps);
      if (!Number.isFinite(n) || n < 30 || n > 1000) {
        throw new RangeError("FPS must be from 30 to 1000.");
      }
      state.targetFPS = n;
      nextTickAt = performance.now();
      if (state.running) scheduleNext();
      updateOverlay();
      return n;
    };

    state.start = () => {
      cancelConstructSchedule();
      runtime.tick = patchedTick;
      state.running = true;
      nextTickAt = performance.now();
      engineFrames = 0;
      engineWindowStart = performance.now();
      scheduleNext();
      updateOverlay();
    };

    state.stop = () => {
      if (!state.installed) return;
      state.running = false;
      clearCustomTimer();
      cancelConstructSchedule();
      runtime.tick = originalTick;
      setOverlayText("OvO FPS UNLOCKER: stopped — stock scheduler restored");

      try {
        originalTick.call(runtime, false, performance.now(), false);
      } catch (err) {
        state.lastError = err;
        setOverlayText(`OvO FPS UNLOCKER RESTORE ERROR: ${err && err.message ? err.message : err}`);
      }
    };

    state.restore = state.stop;
    state.info = () => ({
      installed: state.installed,
      running: state.running,
      targetFPS: state.targetFPS,
      engineTPS: state.engineTPS,
      displayFPS: state.displayFPS,
      constructReportedFPS: Number.isFinite(runtime.fps) ? runtime.fps : null,
      tickCount: Number.isFinite(runtime.tickcount) ? runtime.tickcount : null,
      suspended: !!runtime.isSuspended,
      hidden: !!document.hidden,
      lastError: state.lastError
    });

    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(displayCounter);
    }

    cancelConstructSchedule();
    runtime.tick = patchedTick;
    nextTickAt = performance.now();
    scheduleNext();
    state.showOverlay();
  }

  const startedAt = performance.now();

  function waitForRuntime() {
    const runtime = resolveRuntime();
    if (runtime) {
      setOverlayText("OvO FPS UNLOCKER: Construct runtime found — installing...");
      try {
        install(runtime);
      } catch (err) {
        state.lastError = err;
        setOverlayText(`OvO FPS UNLOCKER INSTALL ERROR: ${err && err.message ? err.message : err}`);
      }
      return;
    }

    const elapsed = performance.now() - startedAt;
    if (elapsed >= MAX_WAIT_MS) {
      state.lastError = new Error("Construct 2 runtime not found");
      setOverlayText("OvO FPS UNLOCKER ERROR: Construct runtime not found after 20s");
      return;
    }

    setOverlayText(`OvO FPS UNLOCKER: JS LOADED — waiting for Construct... ${Math.floor(elapsed / 1000)}s`);
    setTimeout(waitForRuntime, 100);
  }

  waitForRuntime();
})();

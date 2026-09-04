(() => {
  "use strict";

  const GLOBAL_KEY = "__ghostyOvoFpsUnlocker";
  const DEFAULT_FPS = 240;
  const MAX_WAIT_MS = 20000;
  const OVERLAY_ID = "ghosty-ovo-fps-diagnostic";

  if (globalThis[GLOBAL_KEY] && globalThis[GLOBAL_KEY].installed) {
    globalThis[GLOBAL_KEY].setFPS(DEFAULT_FPS);
    globalThis[GLOBAL_KEY].start();
    globalThis[GLOBAL_KEY].showOverlay();
    console.info(`[OvO FPS Unlocker] Already loaded; target set to ${DEFAULT_FPS} FPS.`);
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
    showOverlay: () => {},
    hideOverlay: () => {},
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

    // This is the same runtime bridge used by existing OvO Modloader mods.
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

    // Independent counters: engineTPS counts our actual Construct ticks,
    // displayFPS counts requestAnimationFrame callbacks (usually monitor Hz).
    let engineFrames = 0;
    let engineWindowStart = performance.now();
    let displayFrames = 0;
    let displayWindowStart = performance.now();
    let displayRafId = null;
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
      displayRafId = requestAnimationFrame(displayCounter);
    }

    function getOverlay() {
      return document.getElementById(OVERLAY_ID);
    }

    function updateOverlay() {
      const el = getOverlay();
      if (!el) return;

      const engine = state.engineTPS || "…";
      const display = state.displayFPS || "…";
      el.textContent = `ENGINE ${engine} TPS  |  DISPLAY ${display} FPS  |  TARGET ${state.targetFPS}`;
    }

    state.showOverlay = () => {
      let el = getOverlay();
      if (!el) {
        el = document.createElement("div");
        el.id = OVERLAY_ID;
        Object.assign(el.style, {
          position: "fixed",
          left: "8px",
          bottom: "8px",
          zIndex: "2147483647",
          padding: "5px 8px",
          background: "rgba(255,255,255,.92)",
          color: "#000",
          border: "2px solid #000",
          font: "bold 12px monospace",
          pointerEvents: "none",
          whiteSpace: "nowrap"
        });
        (document.body || document.documentElement).appendChild(el);
      }
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

      // Never try to process a giant backlog after a pause or lag spike.
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
        // Keep real timestamps so higher TPS does NOT deliberately multiply
        // the game's time scale. We only change how often Construct is ticked.
        originalTick.call(runtime, false, now, false);
        sampleEngineTPS(performance.now());

        // originalTick schedules Construct's normal RAF. Kill that schedule so
        // our timer is the only foreground game-loop driver.
        cancelConstructSchedule();
      } catch (err) {
        state.lastError = err;
        console.error("[OvO FPS Unlocker] Tick failed; restoring stock scheduler.", err);
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
        throw new RangeError("FPS must be a finite number from 30 to 1000.");
      }
      state.targetFPS = n;
      nextTickAt = performance.now();
      if (state.running) scheduleNext();
      updateOverlay();
      console.info(`[OvO FPS Unlocker] Target set to ${n} FPS.`);
      return n;
    };

    state.start = () => {
      if (state.running && runtime.tick === patchedTick) return;
      cancelConstructSchedule();
      runtime.tick = patchedTick;
      state.running = true;
      nextTickAt = performance.now();
      engineFrames = 0;
      engineWindowStart = performance.now();
      scheduleNext();
      console.info(`[OvO FPS Unlocker] Running at ${state.targetFPS} TPS target.`);
    };

    state.stop = () => {
      if (!state.installed) return;
      state.running = false;
      clearCustomTimer();
      cancelConstructSchedule();
      runtime.tick = originalTick;

      try {
        originalTick.call(runtime, false, performance.now(), false);
      } catch (err) {
        state.lastError = err;
        console.error("[OvO FPS Unlocker] Could not restart stock scheduler.", err);
      }

      console.info("[OvO FPS Unlocker] Disabled; stock Construct scheduler restored.");
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
      displayRafId = requestAnimationFrame(displayCounter);
    }

    cancelConstructSchedule();
    runtime.tick = patchedTick;
    nextTickAt = performance.now();
    scheduleNext();
    state.showOverlay();

    console.info(
      `[OvO FPS Unlocker] Loaded. Target: ${state.targetFPS} TPS. ` +
      "ENGINE = Construct ticks/sec; DISPLAY = browser RAF/display refresh. " +
      "Console: ovoFPS.info(), ovoFPS.setFPS(144), ovoFPS.setFPS(240), ovoFPS.hideOverlay()"
    );
  }

  const startedAt = performance.now();
  const waitForRuntime = () => {
    const runtime = resolveRuntime();
    if (runtime) {
      install(runtime);
      return;
    }

    if (performance.now() - startedAt >= MAX_WAIT_MS) {
      state.lastError = new Error("Construct 2 runtime not found");
      console.error("[OvO FPS Unlocker] Could not find the OvO/Construct 2 runtime.");
      return;
    }

    setTimeout(waitForRuntime, 50);
  };

  waitForRuntime();
})();

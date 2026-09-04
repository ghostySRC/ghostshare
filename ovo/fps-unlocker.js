(() => {
  "use strict";

  const GLOBAL_KEY = "__ghostyOvoFpsUnlocker";
  const DEFAULT_FPS = 240;
  const MAX_WAIT_MS = 20000;

  // If the mod is loaded twice, reuse the existing instance instead of
  // installing a second game loop.
  if (globalThis[GLOBAL_KEY] && globalThis[GLOBAL_KEY].installed) {
    globalThis[GLOBAL_KEY].setFPS(DEFAULT_FPS);
    globalThis[GLOBAL_KEY].start();
    console.info(`[OvO FPS Unlocker] Already loaded; target set to ${DEFAULT_FPS} FPS.`);
    return;
  }

  const state = {
    installed: false,
    running: false,
    targetFPS: DEFAULT_FPS,
    runtime: null,
    lastError: null,
    setFPS: () => {},
    start: () => {},
    stop: () => {},
    restore: () => {},
    info: () => ({ installed: false, running: false, targetFPS: DEFAULT_FPS })
  };
  globalThis[GLOBAL_KEY] = state;
  // Short alias for console use: ovoFPS.setFPS(144), ovoFPS.stop(), etc.
  globalThis.ovoFPS = state;

  function resolveRuntime() {
    // Standard Construct 2 runtime accessor.
    try {
      if (typeof globalThis.cr_getC2Runtime === "function") {
        const rt = globalThis.cr_getC2Runtime();
        if (rt && typeof rt.tick === "function") return rt;
      }
    } catch (_) {}

    // OvO Modloader-compatible fallback. Existing OvO mods use the same
    // execCode bridge to get at the Construct 2 runtime.
    try {
      if (typeof globalThis.c2_callFunction === "function") {
        const key = "__ghostyOvoFpsRuntime";
        const hadOld = Object.prototype.hasOwnProperty.call(globalThis, key);
        const old = globalThis[key];

        globalThis.c2_callFunction("execCode", [
          `globalThis.${key} = this.runtime`
        ]);

        const rt = globalThis[key];
        if (hadOld) globalThis[key] = old;
        else delete globalThis[key];

        if (rt && typeof rt.tick === "function") return rt;
      }
    } catch (_) {}

    // Last-resort canvas lookup used by normal Construct 2 exports.
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

    function scheduleNext() {
      if (!state.running) return;

      // Construct normally suspends itself in a hidden tab. Do not burn CPU
      // while hidden; its normal resume path will call runtime.tick again.
      if (runtime.isSuspended || document.hidden) {
        clearCustomTimer();
        timerId = setTimeout(scheduleNext, 100);
        return;
      }

      const fps = state.targetFPS;
      const interval = 1000 / fps;
      const now = performance.now();

      // After a breakpoint, lag spike, tab switch, etc. do not attempt to run
      // a huge backlog of catch-up ticks.
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
      try {
        // Run Construct's real tick so its delta-time remains based on actual
        // elapsed time. Construct schedules a native RAF at the start of this
        // call; cancel that schedule immediately afterwards so only our higher
        // frequency scheduler drives the game.
        originalTick.call(runtime, false, timestamp || performance.now(), false);
        cancelConstructSchedule();
      } catch (err) {
        state.lastError = err;
        console.error("[OvO FPS Unlocker] Tick failed; restoring normal scheduler.", err);
        state.stop();
        return;
      } finally {
        inTick = false;
      }

      scheduleNext();
    }

    function patchedTick(backgroundWake, timestamp, debugStep) {
      // Preserve Construct's special background/debug behavior.
      if (backgroundWake || debugStep) {
        return originalTick.call(runtime, backgroundWake, timestamp, debugStep);
      }

      // Construct calls tick(false) itself when resuming. Fold that request
      // back into the unlocked scheduler rather than creating another loop.
      clearCustomTimer();
      nextTickAt = performance.now();
      runUnlockedTick(timestamp || performance.now());
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
      console.info(`[OvO FPS Unlocker] Target set to ${n} FPS.`);
      return n;
    };

    state.start = () => {
      if (state.running && runtime.tick === patchedTick) return;
      cancelConstructSchedule();
      runtime.tick = patchedTick;
      state.running = true;
      nextTickAt = performance.now();
      scheduleNext();
      console.info(`[OvO FPS Unlocker] Running at ${state.targetFPS} FPS target.`);
    };

    state.stop = () => {
      if (!state.installed) return;
      state.running = false;
      clearCustomTimer();
      cancelConstructSchedule();
      runtime.tick = originalTick;

      // Kick Construct's original RAF loop back on immediately.
      try {
        originalTick.call(runtime, false, performance.now(), false);
      } catch (err) {
        state.lastError = err;
        console.error("[OvO FPS Unlocker] Could not restart the stock scheduler.", err);
      }

      console.info("[OvO FPS Unlocker] Disabled; stock Construct scheduler restored.");
    };

    state.restore = state.stop;
    state.info = () => ({
      installed: state.installed,
      running: state.running,
      targetFPS: state.targetFPS,
      measuredConstructFPS: Number.isFinite(runtime.fps) ? runtime.fps : null,
      tickCount: Number.isFinite(runtime.tickcount) ? runtime.tickcount : null,
      lastError: state.lastError
    });

    cancelConstructSchedule();
    runtime.tick = patchedTick;
    nextTickAt = performance.now();
    scheduleNext();

    console.info(
      `[OvO FPS Unlocker] Loaded. Target: ${state.targetFPS} FPS. ` +
      "Console controls: ovoFPS.setFPS(144), ovoFPS.setFPS(240), ovoFPS.stop(), ovoFPS.start(), ovoFPS.info()"
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

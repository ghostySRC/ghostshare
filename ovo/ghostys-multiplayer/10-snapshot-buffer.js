(function (root) {
  "use strict";
  const ns = root.GMPInternal;

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function lerpAngle(a, b, t) {
    let delta = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta < -Math.PI) delta += Math.PI * 2;
    return a + delta * t;
  }

  class SnapshotBuffer {
    constructor(options = {}) {
      this.maxSnapshots = options.maxSnapshots || 20;
      this.interpolationDelayMs = options.interpolationDelayMs || 100;
      this.snapshots = [];
    }

    clear() {
      this.snapshots.length = 0;
    }

    push(state, receivedAt = performance.now()) {
      if (!state || !Number.isFinite(state.x) || !Number.isFinite(state.y)) return;
      const snapshot = { receivedAt, state: { ...state } };
      const last = this.snapshots[this.snapshots.length - 1];
      if (last && receivedAt < last.receivedAt) {
        let index = this.snapshots.findIndex((s) => s.receivedAt > receivedAt);
        if (index === -1) index = this.snapshots.length;
        this.snapshots.splice(index, 0, snapshot);
      } else {
        this.snapshots.push(snapshot);
      }
      if (this.snapshots.length > this.maxSnapshots) {
        this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots);
      }
    }

    sample(now = performance.now()) {
      if (this.snapshots.length === 0) return null;
      if (this.snapshots.length === 1) return { ...this.snapshots[0].state };

      const target = now - this.interpolationDelayMs;
      while (this.snapshots.length > 2 && this.snapshots[1].receivedAt <= target) {
        this.snapshots.shift();
      }

      const a = this.snapshots[0];
      const b = this.snapshots[1];
      if (target <= a.receivedAt) return { ...a.state };
      if (target >= b.receivedAt) {
        const latest = this.snapshots[this.snapshots.length - 1];
        return { ...latest.state };
      }

      const span = Math.max(1, b.receivedAt - a.receivedAt);
      const t = ns.clamp((target - a.receivedAt) / span, 0, 1);
      const useB = t >= 0.5;
      return {
        ...a.state,
        x: lerp(a.state.x, b.state.x, t),
        y: lerp(a.state.y, b.state.y, t),
        angle: lerpAngle(a.state.angle || 0, b.state.angle || 0, t),
        state: useB ? b.state.state : a.state.state,
        side: useB ? b.state.side : a.state.side,
        skin: useB ? b.state.skin : a.state.skin,
        frame: useB ? b.state.frame : a.state.frame,
        layout: useB ? b.state.layout : a.state.layout,
        layer: useB ? b.state.layer : a.state.layer,
        username: useB ? b.state.username : a.state.username
      };
    }
  }

  Object.assign(ns, { SnapshotBuffer, lerp, lerpAngle });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { SnapshotBuffer, lerp, lerpAngle };
  }
})(globalThis);

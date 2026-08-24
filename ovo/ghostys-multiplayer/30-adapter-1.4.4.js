(function (root) {
  "use strict";
  const ns = root.GMPInternal;

  class OvO144Adapter {
    constructor(runtime) {
      this.runtime = runtime;
      this.playerType = null;
      this.textType = null;
      this.globalType = null;
      this.ghostArrayType = null;
      this.endFlagType = null;
      this.remoteInstances = new Map();
      this.localLabels = null;
      this.localPlayerUid = null;
      this.multiplayerActive = false;
      this.disabledGhostActions = null;
      this.resolveTypes();
    }

    resolveTypes() {
      const runtime = this.runtime;
      this.playerType = runtime.types_by_index.find((x) =>
        x.animations && x.animations[0] && x.animations[0].frames &&
        x.animations[0].frames[0] &&
        String(x.animations[0].frames[0].texture_file || "").includes("collider")
      );
      this.textType = runtime.types_by_index.find((x) =>
        x.name === "TextAlign" ||
        (root.cr && root.cr.plugins_ && root.cr.plugins_.TextModded &&
          x.plugin instanceof root.cr.plugins_.TextModded && x.vars_count === 8 && !x.is_family)
      );
      this.globalType = runtime.types_by_index.find((x) =>
        root.cr && root.cr.plugins_ && root.cr.plugins_.Globals &&
        x.plugin instanceof root.cr.plugins_.Globals && x.instvar_sids && x.instvar_sids.length === 24
      );
      this.ghostArrayType = runtime.types_by_index.find((x) =>
        root.cr && root.cr.plugins_ && root.cr.plugins_.Arr &&
        x.plugin instanceof root.cr.plugins_.Arr && x.default_instance &&
        x.default_instance[5] && x.default_instance[5][1] === 6
      ) || null;
      this.endFlagType = runtime.types_by_index.find((x) =>
        x.animations && x.animations[0] && x.animations[0].frames &&
        x.animations[0].frames[0] &&
        String(x.animations[0].frames[0].texture_file || "").includes("endflag")
      ) || null;
      if (!this.playerType || !this.textType || !this.globalType) {
        throw new Error("Ghosty's Multiplayer could not resolve OvO 1.4.4 runtime types.");
      }
    }

    currentLayout() {
      return this.runtime.running_layout && this.runtime.running_layout.name || "Unknown";
    }

    getLocalPlayer() {
      return this.playerType.instances.find((x) =>
        x && x.instance_vars && x.instance_vars[17] === "" &&
        x.behavior_insts && x.behavior_insts[0] &&
        !x.__gmpRemote
      ) || null;
    }

    getLocalState(username) {
      const player = this.getLocalPlayer();
      const fallbackSkin = this.globalType.instances[0] && this.globalType.instances[0].instance_vars
        ? this.globalType.instances[0].instance_vars[8] || ""
        : "";
      if (!player) {
        return {
          layout: this.currentLayout(),
          username,
          skin: fallbackSkin,
          active: false
        };
      }
      return {
        active: true,
        x: player.x,
        y: player.y,
        angle: player.angle || 0,
        state: player.instance_vars[0],
        side: player.instance_vars[2],
        skin: player.instance_vars[12] || fallbackSkin,
        frame: Number.isFinite(player.cur_frame) ? player.cur_frame : 0,
        pose: this.capturePose(player),
        layout: this.currentLayout(),
        layer: player.layer && player.layer.name || "Game",
        username
      };
    }

    listRaceLayouts() {
      return Object.keys(this.runtime.layouts || {})
        .filter((name) => /^Level \d+$/.test(name))
        .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
    }

    changeLayout(name) {
      const layout = this.runtime.layouts && this.runtime.layouts[name];
      if (!layout) return false;
      this.runtime.changelayout = layout;
      return true;
    }

    setLocalControlsEnabled(enabled) {
      const player = this.getLocalPlayer();
      if (!player || !player.behavior_insts || !player.behavior_insts[0]) return false;
      player.behavior_insts[0].enabled = !!enabled;
      return true;
    }

    isAtFinish() {
      const player = this.getLocalPlayer();
      if (!player || !this.endFlagType || !this.endFlagType.instances) return false;
      return this.endFlagType.instances.some((flag) => {
        try { return !!this.runtime.testOverlap(player, flag); } catch (_) { return false; }
      });
    }

    setMultiplayerActive(active) {
      this.multiplayerActive = !!active;
      if (this.multiplayerActive) {
        this.disableBuiltInGhosts();
        this.destroyBuiltInGhosts();
      } else {
        this.destroyLocalLabels();
        this.restoreBuiltInGhosts();
      }
    }

    disableBuiltInGhosts() {
      if (this.disabledGhostActions) return;
      try {
        const actions = this.runtime.eventsheets.Player.events[2]
          .subevents[2].subevents[1].actions;
        this.disabledGhostActions = { actions, saved: actions.slice() };
        actions.length = 0;
      } catch (_) {
        this.disabledGhostActions = null;
      }
    }

    restoreBuiltInGhosts() {
      if (!this.disabledGhostActions) return;
      const { actions, saved } = this.disabledGhostActions;
      actions.push(...saved);
      this.disabledGhostActions = null;
    }

    destroyBuiltInGhosts() {
      if (!this.multiplayerActive) return;
      const ghosts = this.playerType.instances.filter((instance) =>
        instance && !instance.__gmpRemote && instance.instance_vars &&
        instance.instance_vars[16] && instance.instance_vars[17] !== ""
      );
      for (const ghost of ghosts) {
        try {
          this.resetSiblingSkins(ghost);
          this.runtime.DestroyInstance(ghost);
        } catch (_) {}
      }
      const ghostArray = this.ghostArrayType && this.ghostArrayType.instances
        ? this.ghostArrayType.instances[0]
        : null;
      try {
        if (ghostArray && typeof ghostArray.setSize === "function") {
          ghostArray.setSize(0, ghostArray.cy, ghostArray.cz);
        }
      } catch (_) {}
    }

    updateLocalPlayerLabel(username) {
      if (!this.multiplayerActive) return this.destroyLocalLabels();
      const player = this.getLocalPlayer();
      if (!player || !player.layer) return this.destroyLocalLabels();
      if (!this.localLabels || this.localPlayerUid !== player.uid) {
        this.destroyLocalLabels();
        this.localPlayerUid = player.uid;
        this.localLabels = this.createLabels(player.layer, username || "Player", player.x, player.y);
      }
      this.updateLabels(this.localLabels, username || "Player", player.x, player.y);
    }

    destroyLocalLabels() {
      this.destroyLabels(this.localLabels);
      this.localLabels = null;
      this.localPlayerUid = null;
    }

    handleLayoutChange() {
      this.destroyAllRemotePlayers();
      this.destroyLocalLabels();
      if (this.multiplayerActive) {
        this.disableBuiltInGhosts();
        this.destroyBuiltInGhosts();
      }
    }

    createRemotePlayer(playerId, state) {
      if (!state || !state.active || state.layout !== this.currentLayout()) return null;
      if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) return null;
      const layer = this.runtime.running_layout.layers.find((x) => x.name === state.layer);
      if (!layer) return null;

      const instance = this.runtime.createInstance(this.playerType, layer, state.x, state.y);
      instance.__gmpRemote = true;
      instance.visible = false;
      if (instance.behavior_insts && instance.behavior_insts[0]) {
        instance.behavior_insts[0].enabled = false;
      }
      if (instance.instance_vars) {
        instance.instance_vars[16] = 1;
        instance.instance_vars[17] = "";
        instance.instance_vars[12] = state.skin || "";
      }

      const remote = {
        playerId,
        instance,
        labels: this.createLabels(layer, state.username || "Player", state.x, state.y),
        skin: null,
        side: null,
        frame: null
      };
      this.remoteInstances.set(playerId, remote);
      setTimeout(() => this.applySkin(remote, state.skin || ""), 100);
      return remote;
    }

    destroyRemotePlayer(playerId) {
      const remote = typeof playerId === "string" ? this.remoteInstances.get(playerId) : playerId;
      if (!remote) return;
      try {
        if (remote.instance) {
          this.resetSiblingSkins(remote.instance);
          this.runtime.DestroyInstance(remote.instance);
        }
      } catch (_) {}
      this.destroyLabels(remote.labels);
      if (typeof playerId === "string") this.remoteInstances.delete(playerId);
      else if (remote.playerId) this.remoteInstances.delete(remote.playerId);
    }

    destroyAllRemotePlayers() {
      for (const id of Array.from(this.remoteInstances.keys())) this.destroyRemotePlayer(id);
    }

    destroyLabels(labels) {
      for (const label of labels || []) {
        try { this.runtime.DestroyInstance(label); } catch (_) {}
      }
    }

    updateRemotePlayer(playerId, state) {
      let remote = this.remoteInstances.get(playerId);
      if (!state || !state.active || state.layout !== this.currentLayout()) {
        if (remote) this.destroyRemotePlayer(playerId);
        return;
      }
      if (!remote) remote = this.createRemotePlayer(playerId, state);
      if (!remote || !remote.instance) return;

      const instance = remote.instance;
      instance.x = state.x;
      instance.y = state.y;
      instance.angle = state.angle || 0;
      instance.visible = false;
      if (instance.behavior_insts && instance.behavior_insts[0]) {
        instance.behavior_insts[0].enabled = false;
      }
      if (instance.instance_vars) {
        instance.instance_vars[0] = state.state;
        instance.instance_vars[2] = state.side;
      }
      if (state.side !== remote.side) {
        remote.side = state.side;
        try {
          if (state.side > 0) root.c2_callFunction("Player > Unmirror", [instance.uid]);
          if (state.side < 0) root.c2_callFunction("Player > Mirror", [instance.uid]);
        } catch (_) {}
      }
      if (Number.isFinite(state.frame) && state.frame !== remote.frame) {
        remote.frame = state.frame;
        try { root.cr.plugins_.Sprite.prototype.acts.SetAnimFrame.call(instance, state.frame); } catch (_) {}
      }
      if ((state.skin || "") !== remote.skin) this.applySkin(remote, state.skin || "");
      this.applyPose(remote, state.pose, state.x, state.y);
      this.normalizeRemoteVisuals(remote);
      this.updateLabels(remote.labels, state.username || "Player", state.x, state.y);
      instance.set_bbox_changed();
    }

    createLabels(layer, username, x, y) {
      const offsets = [[-2, 0], [2, 0], [0, -2], [0, 2], [0, 0]];
      return offsets.map(([ox, oy], index) => {
        const inst = this.runtime.createInstance(this.textType, layer, x - 100 + ox, y - 55 + oy);
        inst.text = username;
        inst.height = 25;
        inst.width = 200;
        inst.facename = "Retron2000";
        inst.halign = 50;
        inst.valign = 50;
        inst.color = index === 4 ? "rgb(255,255,255)" : "rgb(0,0,0)";
        inst.fontstyle = index === 4 ? "" : "bold";
        inst.visible = true;
        inst.opacity = 1;
        if (typeof inst.updateFont === "function") inst.updateFont();
        inst.set_bbox_changed();
        return inst;
      });
    }

    updateLabels(labels, username, x, y) {
      const offsets = [[-2, 0], [2, 0], [0, -2], [0, 2], [0, 0]];
      (labels || []).forEach((inst, index) => {
        if (!inst) return;
        const [ox, oy] = offsets[index] || [0, 0];
        inst.x = x - 100 + ox;
        inst.y = y - 55 + oy;
        inst.visible = true;
        inst.opacity = 1;
        if (inst.text !== username) {
          inst.text = username;
          if (typeof inst.updateFont === "function") inst.updateFont();
        }
        inst.set_bbox_changed();
      });
    }

    capturePose(player) {
      if (!player || !Array.isArray(player.siblings)) return [];
      return player.siblings.slice(0, 16).map((sibling) => [
        Number(sibling.x) - Number(player.x),
        Number(sibling.y) - Number(player.y),
        Number(sibling.angle) || 0,
        Number(sibling.width) || 0,
        Number(sibling.height) || 0,
        Number.isFinite(sibling.cur_frame) ? sibling.cur_frame : 0,
        sibling.visible === false ? 0 : 1
      ]);
    }

    applyPose(remote, pose, x, y) {
      if (!remote || !remote.instance || !Array.isArray(pose)) return;
      const siblings = remote.instance.siblings || [];
      const count = Math.min(siblings.length, pose.length);
      for (let i = 0; i < count; i++) {
        const sibling = siblings[i];
        const part = pose[i];
        if (!sibling || !Array.isArray(part)) continue;
        sibling.x = x + (Number(part[0]) || 0);
        sibling.y = y + (Number(part[1]) || 0);
        sibling.angle = Number(part[2]) || 0;
        if (Number.isFinite(Number(part[3]))) sibling.width = Number(part[3]);
        if (Number.isFinite(Number(part[4]))) sibling.height = Number(part[4]);
        if (Number.isFinite(Number(part[5])) && sibling.cur_frame !== Number(part[5])) {
          try { root.cr.plugins_.Sprite.prototype.acts.SetAnimFrame.call(sibling, Number(part[5])); } catch (_) {}
        }
        const hasCustomSkin = (sibling.behaviorSkins || []).some((behavior) => behavior && !behavior.default);
        sibling.visible = hasCustomSkin ? false : !!part[6];
        sibling.set_bbox_changed();
      }
    }

    normalizeRemoteVisuals(remote) {
      if (!remote || !remote.instance) return;
      remote.instance.visible = false;
      remote.instance.opacity = 0;
      if (remote.instance.behavior_insts && remote.instance.behavior_insts[0]) {
        remote.instance.behavior_insts[0].enabled = false;
      }
      for (const sibling of remote.instance.siblings || []) {
        sibling.opacity = 1;
        const behaviors = sibling.behaviorSkins || [];
        if (!behaviors.length) sibling.visible = true;
        for (const behavior of behaviors) {
          if (!behavior) continue;
          if (behavior.object) {
            behavior.object.visible = true;
            behavior.object.opacity = 1;
            behavior.object.set_bbox_changed();
          } else if (behavior.default) {
            sibling.visible = true;
          }
        }
        sibling.set_bbox_changed();
      }
    }

    applySkin(remote, skin) {
      if (!remote || !remote.instance) return;
      remote.skin = skin;
      if (remote.instance.instance_vars) remote.instance.instance_vars[12] = skin;
      for (const sibling of remote.instance.siblings || []) {
        for (const behavior of sibling.behaviorSkins || []) {
          try {
            if (!skin) root.cr.behaviors.SkymenSkin.prototype.acts.UseDefault.call(behavior);
            else root.cr.behaviors.SkymenSkin.prototype.acts.SetSkin.call(behavior, skin);
          } catch (_) {}
        }
      }
      this.normalizeRemoteVisuals(remote);
    }

    resetSiblingSkins(instance) {
      for (const sibling of instance.siblings || []) {
        try {
          const behavior = sibling.behaviorSkins && sibling.behaviorSkins[0];
          if (behavior) root.cr.behaviors.SkymenSkin.prototype.acts.UseDefault.call(behavior);
        } catch (_) {}
      }
    }
  }

  Object.assign(ns, { OvO144Adapter });
})(globalThis);

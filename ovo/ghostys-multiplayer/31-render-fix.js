(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  const Adapter = ns.OvO144Adapter;
  if (!Adapter || Adapter.prototype.__gmpRenderFix) return;

  const proto = Adapter.prototype;

  proto.applySkin = function applySkin(remote, skin) {
    if (!remote || !remote.instance) return;
    skin = String(skin || "");
    remote.skin = skin;
    if (remote.instance.instance_vars) remote.instance.instance_vars[12] = skin;

    const applyPass = () => {
      if (!this.remoteInstanceIsLive(remote) || this.remoteInstances.get(remote.playerId) !== remote) return;
      for (const sibling of remote.instance.siblings || []) {
        for (const behavior of sibling.behaviorSkins || []) {
          if (!behavior) continue;
          try {
            if (skin) root.cr.behaviors.SkymenSkin.prototype.acts.SetSkin.call(behavior, skin);
            else root.cr.behaviors.SkymenSkin.prototype.acts.UseDefault.call(behavior);
          } catch (error) {
            console.debug("[GMP] Remote skin pass failed", error);
          }
        }
      }
      this.normalizeRemoteVisuals(remote);
      for (const sibling of remote.instance.siblings || []) {
        for (const behavior of sibling.behaviorSkins || []) {
          if (behavior && behavior.object) this.markSkinObject(behavior.object, remote.playerId);
        }
      }
    };

    // Construct creates container siblings and their skin behaviors over
    // several ticks. Do not force the default body visible after SetSkin:
    // SkymenSkin intentionally hides it when a custom skin is active.
    applyPass();
    for (const delay of [50, 150, 300, 700]) setTimeout(applyPass, delay);
  };

  const oldCreateRemotePlayer = proto.createRemotePlayer;
  proto.createRemotePlayer = function createRemotePlayer(playerId, state) {
    const remote = oldCreateRemotePlayer.call(this, playerId, state);
    if (!remote) return remote;
    this.normalizeRemoteVisuals(remote);
    return remote;
  };

  proto.__gmpRenderFix = true;
})(globalThis);

(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  const Adapter = ns.OvO144Adapter;
  if (!Adapter || Adapter.prototype.__gmpRenderFix) return;

  const proto = Adapter.prototype;

  function safeFrameSize(instance) {
    const frame = instance && instance.curFrame;
    return {
      width: Number(frame && frame.width) || Number(instance && instance.width) || 1,
      height: Number(frame && frame.height) || Number(instance && instance.height) || 1
    };
  }

  proto.applySkin = function applySkin(remote, skin) {
    if (!remote || !remote.instance) return;
    skin = String(skin || "");
    remote.skin = skin;

    const collider = remote.instance;
    if (collider.instance_vars) collider.instance_vars[12] = skin;

    const applyPass = () => {
      if (!remote.instance || !this.remoteInstances.has(remote.playerId)) return;
      const activeCollider = remote.instance;
      const colliderFrame = safeFrameSize(activeCollider);
      const colliderWidth = Number(activeCollider.width) || colliderFrame.width;
      const colliderHeight = Number(activeCollider.height) || colliderFrame.height;

      for (const sibling of activeCollider.siblings || []) {
        try {
          const behavior = sibling.behaviorSkins && sibling.behaviorSkins[0];
          if (!behavior) continue;

          // Match the site's own skin-switching path. SkymenSkin needs these
          // flags and a size refresh or newly-created remote players can stay
          // on the unskinned/default visual.
          behavior.syncScale = true;
          behavior.syncSize = false;

          if (sibling.curFrame) {
            sibling.width = sibling.curFrame.width;
            sibling.height = sibling.curFrame.height;
            sibling.set_bbox_changed();
          }

          if (!skin) {
            root.cr.behaviors.SkymenSkin.prototype.acts.UseDefault.call(behavior);
          } else {
            root.cr.behaviors.SkymenSkin.prototype.acts.SetSkin.call(behavior, skin);
          }

          // SetSkin can swap the current frame, so read it again afterwards.
          if (sibling.curFrame) {
            sibling.width = (colliderWidth / colliderFrame.width) * sibling.curFrame.width;
            sibling.height = (colliderHeight / colliderFrame.height) * sibling.curFrame.height;
          }
          sibling.visible = true;
          sibling.set_bbox_changed();
        } catch (error) {
          console.debug("[GMP] Remote skin pass failed", error);
        }
      }
    };

    // Construct creates container siblings and skin behaviors over several
    // ticks. Apply immediately, then retry after they are fully initialized.
    applyPass();
    for (const delay of [50, 150, 300, 700]) setTimeout(applyPass, delay);
  };

  const oldCreateRemotePlayer = proto.createRemotePlayer;
  proto.createRemotePlayer = function createRemotePlayer(playerId, state) {
    const remote = oldCreateRemotePlayer.call(this, playerId, state);
    if (!remote) return remote;
    // Keep the collision sprite itself hidden; only the visual siblings render.
    if (remote.instance) remote.instance.visible = false;
    return remote;
  };

  proto.__gmpRenderFix = true;
})(globalThis);

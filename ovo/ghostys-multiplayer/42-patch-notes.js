(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  const BaseUI = ns.GhostyUI;
  if (!BaseUI || BaseUI.__gmpPatchNotes) return;

  const PATCH_NOTES = [
    {
      version: "0.2.0-alpha.3",
      title: "Clean room transitions",
      changes: [
        "Added a large in-game countdown, GO signal and finish-time overlay that never blocks game controls.",
        "Fixed switching rooms or failing a Browse join leaving the old room and player UI stuck on screen.",
        "Added connection and handshake timeouts so silent PeerJS failures recover instead of hanging forever.",
        "Rejected outdated protocol clients before they could create partially synchronized players.",
        "Stopped interpolation across level changes and long respawn teleports."
      ]
    },
    {
      version: "0.2.0-alpha.2",
      title: "Race and directory hardening",
      changes: [
        "Synchronized race countdowns using measured host clock offset and blocked incompatible or mid-race joins.",
        "Fixed multiple tabs for the same friend overwriting each other's online and in-room presence.",
        "Stopped private friend room codes from appearing in unfiltered directory snapshots.",
        "Removed stale rooms immediately when a host switches rooms or a directory client disconnects.",
        "Added PeerJS signaling reconnects, load timeouts and reliable version-folder path resolution.",
        "Made newly copied invite links join their room automatically."
      ]
    },
    {
      version: "0.2.0-alpha.1",
      title: "Every multiplayer tab works",
      changes: [
        "Enabled Race rooms with synchronized level starts, countdowns, end-flag finish detection and live results.",
        "Added public Freeplay and Race room publishing, browsing, refreshing and one-click joining without a dedicated server.",
        "Added persistent friend codes, online presence, room status, joining and removal controls.",
        "Rebuilt tab navigation so Lobby, Race, Browse, Friends and Patch Notes behave as real independent views.",
        "Hardened room visibility, race packet validation, directory cleanup and loader updates."
      ]
    },
    {
      version: "0.1.0-alpha.8",
      title: "Real player animation sync",
      changes: [
        "Fixed movement states such as run, jump and idle being converted to zero during network validation.",
        "Added interpolated limb-pose synchronization so remote players match the sender instead of freezing in OvO's ghost pose.",
        "Removed the forced 50% replay-ghost opacity and stopped default body parts appearing underneath custom skins.",
        "Hardened local username labels, host-disconnect cleanup and same-page loader updates.",
        "Fixed early Create Room and username clicks being ignored while PeerJS was still loading."
      ]
    },
    {
      version: "0.1.0-alpha.7",
      title: "Clean player rendering",
      changes: [
        "Removed OvO's built-in replay ghost while a multiplayer room is active, preventing duplicate grey players.",
        "Added the local player's own outlined username above their character.",
        "Restored OvO's replay-ghost behavior and removed the local label after leaving a room."
      ]
    },
    {
      version: "0.1.0-alpha.6",
      title: "Patch notes arrive",
      changes: [
        "Added a Patch Notes tab directly inside the Ghosty's Multiplayer menu.",
        "Added the current GMP version to the patch notes header.",
        "Patch history now stays available in-game instead of only being posted in chat."
      ]
    },
    {
      version: "0.1.0-alpha.5",
      title: "Remote player visuals",
      changes: [
        "Improved remote skin rendering to follow OvO's own SkymenSkin sizing behavior.",
        "Kept the hidden multiplayer collider invisible while forcing the visual siblings to render.",
        "Added delayed skin re-application to handle Construct objects that initialize over multiple ticks."
      ]
    },
    {
      version: "0.1.0-alpha.4",
      title: "Tabs can play together",
      changes: [
        "Fixed two OvO tabs being treated as the same multiplayer player.",
        "Each browser tab now receives its own session identity while keeping persistent profile settings.",
        "Fixed username input focus and saving while OvO's global input handlers are active.",
        "Pressing Enter in the username field now saves the username."
      ]
    },
    {
      version: "0.1.0-alpha.3",
      title: "UI cleanup",
      changes: [
        "Moved the GMP button away from OvO's menu and community buttons.",
        "Fixed scrolling inside the multiplayer menu.",
        "Made the GMP window modal so the game and site cannot be clicked through it.",
        "Clicking the dark backdrop no longer closes the window accidentally; use X or Escape."
      ]
    },
    {
      version: "0.1.0-alpha.2",
      title: "First integrated playable alpha",
      changes: [
        "Added private six-character multiplayer rooms on OvO 1.4.4.",
        "Added WebRTC/PeerJS transport, player lists, room codes and invite links.",
        "Added 25 Hz player-state sync with snapshot interpolation.",
        "Added username, skin, animation, facing, level and position synchronization.",
        "Added real round-trip ping measurement."
      ]
    }
  ];

  function addStyles() {
    if (document.getElementById("gmp-patch-notes-styles")) return;
    const style = document.createElement("style");
    style.id = "gmp-patch-notes-styles";
    style.textContent = `
      .gmp-patch-header{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}
      .gmp-patch-header h2{margin:0;font-size:26px}
      .gmp-version-chip{border:2px solid black;border-radius:999px;padding:5px 9px;background:#cdefff;font-size:11px;white-space:nowrap}
      .gmp-patch-entry{border:2px solid black;border-radius:10px;background:white;margin-bottom:12px;overflow:hidden}
      .gmp-patch-entry:last-child{margin-bottom:0}
      .gmp-patch-entry-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 13px;border-bottom:2px solid black;background:#f5f5f5}
      .gmp-patch-version{font-size:17px}
      .gmp-patch-title{font-size:11px;opacity:.62;text-align:right}
      .gmp-patch-list{margin:0;padding:12px 18px 13px 32px;line-height:1.45}
      .gmp-patch-list li{margin:0 0 8px}
      .gmp-patch-list li:last-child{margin-bottom:0}
      @media(max-width:650px){.gmp-patch-header{align-items:flex-start;flex-direction:column}.gmp-patch-entry-head{align-items:flex-start;flex-direction:column}.gmp-patch-title{text-align:left}}
    `;
    document.head.appendChild(style);
  }

  class PatchNotesUI extends BaseUI {
    constructor(...args) {
      super(...args);
      addStyles();
      this.installPatchNotes();
    }

    installPatchNotes() {
      const tabs = this.panel.querySelector(".gmp-tabs");
      const body = this.panel.querySelector(".gmp-body");
      if (!tabs || !body || body.querySelector("#gmp-patch-notes-view")) return;

      const patchView = document.createElement("div");
      patchView.id = "gmp-patch-notes-view";
      patchView.className = "gmp-view";

      const header = document.createElement("div");
      header.className = "gmp-patch-header";
      const heading = document.createElement("h2");
      heading.textContent = "Patch Notes";
      const chip = document.createElement("div");
      chip.className = "gmp-version-chip";
      chip.textContent = `Current: ${ns.CLIENT_VERSION}`;
      header.append(heading, chip);
      patchView.appendChild(header);

      for (const release of PATCH_NOTES) {
        const entry = document.createElement("section");
        entry.className = "gmp-patch-entry";

        const entryHead = document.createElement("div");
        entryHead.className = "gmp-patch-entry-head";
        const version = document.createElement("div");
        version.className = "gmp-patch-version";
        version.textContent = release.version;
        const title = document.createElement("div");
        title.className = "gmp-patch-title";
        title.textContent = release.title;
        entryHead.append(version, title);

        const list = document.createElement("ul");
        list.className = "gmp-patch-list";
        for (const change of release.changes) {
          const item = document.createElement("li");
          item.textContent = change;
          list.appendChild(item);
        }

        entry.append(entryHead, list);
        patchView.appendChild(entry);
      }
      body.appendChild(patchView);

      const patchTab = this.addTab("patchNotes", "Patch Notes", patchView);
      patchTab.id = "gmp-patch-notes-tab";
      patchTab.title = "View Ghosty's Multiplayer update history";
      this.refs.patchNotesTab = patchTab;
      this.refs.patchNotesView = patchView;
    }
  }

  PatchNotesUI.__gmpPatchNotes = true;
  ns.GhostyUI = PatchNotesUI;
  ns.PATCH_NOTES = PATCH_NOTES;
})(globalThis);

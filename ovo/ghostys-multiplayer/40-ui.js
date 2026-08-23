(function (root) {
  "use strict";
  const ns = root.GMPInternal;

  class GhostyUI extends EventTarget {
    constructor(options = {}) {
      super();
      this.username = options.username || "OvO Player";
      this.room = null;
      this.players = new Map();
      this.pingMs = null;
      this.connectionState = "offline";
      this.root = null;
      this.panel = null;
      this.refs = {};
      this.injectStyles();
      this.build();
    }

    injectStyles() {
      if (document.getElementById("gmp-styles")) return;
      const style = document.createElement("style");
      style.id = "gmp-styles";
      style.textContent = `
        #gmp-toggle, #gmp-panel, #gmp-toast { font-family: Retron2000, monospace; box-sizing: border-box; }
        #gmp-toggle { position: fixed; top: 4px; left: 52px; width: 40px; height: 35px; z-index: 2147483646; background: white; color: black; border: 2px solid black; border-radius: 5px; cursor: pointer; font-size: 13px; font-weight: 700; }
        #gmp-toggle[data-state="online"] { box-shadow: inset 0 -5px 0 #35c84a; }
        #gmp-toggle[data-state="reconnecting"] { box-shadow: inset 0 -5px 0 #f5a623; }
        #gmp-backdrop { position: fixed; inset: 0; z-index: 2147483644; background: rgba(0,0,0,.28); backdrop-filter: blur(1.2px); display: none; }
        #gmp-panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); z-index: 2147483645; width: min(760px, 92vw); max-height: 88vh; overflow: hidden; background: white; color: black; border: 3px solid black; border-radius: 12px; display: none; }
        .gmp-header { display:flex; align-items:center; justify-content:space-between; padding: 14px 18px; border-bottom:3px solid black; }
        .gmp-title { font-size: clamp(22px, 3vw, 34px); }
        .gmp-close { border:0; background:white; color:#e53935; font-size:30px; cursor:pointer; line-height:1; }
        .gmp-tabs { display:flex; gap:8px; padding:10px 14px; border-bottom:2px solid black; }
        .gmp-tab { flex:1; border:2px solid black; border-radius:8px; background:white; padding:9px; font:inherit; cursor:pointer; }
        .gmp-tab.active { background:#cdefff; }
        .gmp-tab:disabled { opacity:.35; cursor:not-allowed; }
        .gmp-body { padding:18px; overflow:auto; max-height: calc(88vh - 150px); }
        .gmp-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .gmp-card { border:2px solid black; border-radius:10px; padding:14px; background:white; }
        .gmp-card h3 { margin:0 0 10px; font-size:20px; }
        .gmp-field { display:flex; flex-direction:column; gap:6px; margin:10px 0; }
        .gmp-input { border:2px solid black; border-radius:8px; padding:10px 12px; font:inherit; background:white; color:black; }
        .gmp-button { border:2px solid black; border-radius:9px; padding:10px 12px; font:inherit; background:white; color:black; cursor:pointer; }
        .gmp-button.primary { background:#8f67e8; color:white; }
        .gmp-button.danger { background:#ef5350; color:white; }
        .gmp-button:disabled { opacity:.45; cursor:not-allowed; }
        .gmp-row { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .gmp-space { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        .gmp-status-dot { width:10px; height:10px; border-radius:50%; background:#999; display:inline-block; border:1px solid black; }
        .gmp-status-dot.online { background:#35c84a; }
        .gmp-status-dot.reconnecting, .gmp-status-dot.connecting { background:#f5a623; }
        .gmp-code { font-size:28px; letter-spacing:4px; }
        .gmp-muted { opacity:.62; font-size:12px; }
        .gmp-player { display:flex; justify-content:space-between; gap:10px; padding:9px 0; border-bottom:1px solid #ddd; }
        .gmp-player:last-child { border-bottom:0; }
        .gmp-badge { border:1px solid black; border-radius:999px; padding:2px 7px; font-size:10px; }
        #gmp-toast { position:fixed; right:18px; top:18px; z-index:2147483647; display:none; background:black; color:white; border:2px solid white; border-radius:8px; padding:10px 14px; max-width:340px; }
        @media (max-width:650px){ .gmp-grid{grid-template-columns:1fr;} #gmp-panel{width:95vw;} }
      `;
      document.head.appendChild(style);
    }

    build() {
      const toggle = document.createElement("button");
      toggle.id = "gmp-toggle";
      toggle.textContent = "GMP";
      toggle.title = "Ghosty's Multiplayer";
      toggle.dataset.state = "offline";
      document.body.appendChild(toggle);

      const backdrop = document.createElement("div");
      backdrop.id = "gmp-backdrop";
      document.body.appendChild(backdrop);

      const panel = document.createElement("div");
      panel.id = "gmp-panel";
      panel.innerHTML = `
        <div class="gmp-header">
          <div class="gmp-title">Ghosty's Multiplayer</div>
          <button class="gmp-close" id="gmp-close">×</button>
        </div>
        <div class="gmp-tabs">
          <button class="gmp-tab active">Lobby</button>
          <button class="gmp-tab" disabled>Race</button>
          <button class="gmp-tab" disabled>Browse</button>
          <button class="gmp-tab" disabled>Friends</button>
        </div>
        <div class="gmp-body">
          <div class="gmp-space gmp-card" style="margin-bottom:12px">
            <div class="gmp-row"><span id="gmp-status-dot" class="gmp-status-dot"></span><span id="gmp-status-text">Offline</span></div>
            <div id="gmp-ping">-- ms</div>
          </div>
          <div id="gmp-disconnected-view" class="gmp-grid">
            <div class="gmp-card">
              <h3>Profile</h3>
              <label class="gmp-field">Username<input id="gmp-username" class="gmp-input" maxlength="20"></label>
              <button id="gmp-save-name" class="gmp-button">Save username</button>
            </div>
            <div class="gmp-card">
              <h3>Private lobby</h3>
              <button id="gmp-create" class="gmp-button primary" style="width:100%;margin-bottom:10px">Create room</button>
              <div class="gmp-row">
                <input id="gmp-room-code" class="gmp-input" maxlength="6" placeholder="ROOM CODE" style="flex:1;text-transform:uppercase">
                <button id="gmp-join" class="gmp-button">Join</button>
              </div>
              <div class="gmp-muted" style="margin-top:10px">v0.1 alpha uses private Freeplay rooms with smooth remote-player interpolation. Race mode and the public browser are next.</div>
            </div>
            <div class="gmp-card" style="grid-column:1/-1">
              <h3>Network</h3>
              <div>Direct WebRTC rooms via PeerJS</div>
              <div class="gmp-muted" style="margin-top:8px">Playable alpha transport. The dedicated lobby backend will replace room hosting later without changing the OvO sync layer.</div>
            </div>
          </div>
          <div id="gmp-connected-view" style="display:none">
            <div class="gmp-grid">
              <div class="gmp-card">
                <h3>Room</h3>
                <div id="gmp-room-display" class="gmp-code">------</div>
                <div class="gmp-row" style="margin-top:12px"><button id="gmp-copy-code" class="gmp-button">Copy code</button><button id="gmp-copy-invite" class="gmp-button">Copy invite</button></div>
              </div>
              <div class="gmp-card">
                <h3>Session</h3>
                <div id="gmp-room-mode">Freeplay</div>
                <div id="gmp-player-count" style="margin-top:8px">0 players</div>
                <button id="gmp-leave" class="gmp-button danger" style="margin-top:12px">Leave room</button>
              </div>
              <div class="gmp-card" style="grid-column:1/-1">
                <h3>Players</h3>
                <div id="gmp-player-list"></div>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(panel);

      const toast = document.createElement("div");
      toast.id = "gmp-toast";
      document.body.appendChild(toast);

      this.root = toggle;
      this.panel = panel;
      this.refs = {
        toggle, backdrop, panel, toast,
        statusDot: panel.querySelector("#gmp-status-dot"),
        statusText: panel.querySelector("#gmp-status-text"),
        ping: panel.querySelector("#gmp-ping"),
        disconnectedView: panel.querySelector("#gmp-disconnected-view"),
        connectedView: panel.querySelector("#gmp-connected-view"),
        username: panel.querySelector("#gmp-username"),
        roomCode: panel.querySelector("#gmp-room-code"),
        roomDisplay: panel.querySelector("#gmp-room-display"),
        roomMode: panel.querySelector("#gmp-room-mode"),
        playerCount: panel.querySelector("#gmp-player-count"),
        playerList: panel.querySelector("#gmp-player-list")
      };
      this.refs.username.value = this.username;

      toggle.onclick = () => this.setOpen(this.panel.style.display !== "block");
      backdrop.onclick = () => this.setOpen(false);
      panel.querySelector("#gmp-close").onclick = () => this.setOpen(false);
      panel.querySelector("#gmp-save-name").onclick = () => this.emit("save_username", { username: this.refs.username.value.trim() });
      panel.querySelector("#gmp-create").onclick = () => this.emit("create_room", {});
      panel.querySelector("#gmp-join").onclick = () => this.emit("join_room", { roomCode: this.refs.roomCode.value.trim().toUpperCase() });
      panel.querySelector("#gmp-leave").onclick = () => this.emit("leave_room", {});
      panel.querySelector("#gmp-copy-code").onclick = () => this.copy(this.room && this.room.code, "Room code copied");
      panel.querySelector("#gmp-copy-invite").onclick = () => {
        if (!this.room) return;
        const url = new URL(location.href);
        url.searchParams.set("gmpRoom", this.room.code);
        this.copy(url.toString(), "Invite link copied");
      };
      this.refs.roomCode.addEventListener("keydown", (e) => { if (e.key === "Enter") panel.querySelector("#gmp-join").click(); });
    }

    setOpen(open) {
      this.panel.style.display = open ? "block" : "none";
      this.refs.backdrop.style.display = open ? "block" : "none";
    }

    setConnectionState(state) {
      this.connectionState = state;
      this.root.dataset.state = state;
      this.refs.statusDot.className = `gmp-status-dot ${state}`;
      const labels = { offline: "Offline", connecting: "Connecting…", reconnecting: "Reconnecting…", online: "Online" };
      this.refs.statusText.textContent = labels[state] || state;
    }

    setPing(ms) {
      this.pingMs = ms;
      this.refs.ping.textContent = Number.isFinite(ms) ? `${ms} ms` : "-- ms";
    }

    setRoom(room) {
      this.room = room || null;
      this.refs.disconnectedView.style.display = room ? "none" : "grid";
      this.refs.connectedView.style.display = room ? "block" : "none";
      if (room) {
        this.refs.roomDisplay.textContent = room.code || "------";
        this.refs.roomMode.textContent = room.mode ? room.mode[0].toUpperCase() + room.mode.slice(1) : "Freeplay";
      }
      this.renderPlayers();
    }

    setPlayers(players) {
      this.players = new Map((players || []).map((p) => [p.playerId, p]));
      this.renderPlayers();
    }

    upsertPlayer(player) {
      if (!player || !player.playerId) return;
      this.players.set(player.playerId, { ...(this.players.get(player.playerId) || {}), ...player });
      this.renderPlayers();
    }

    removePlayer(playerId) {
      this.players.delete(playerId);
      this.renderPlayers();
    }

    renderPlayers() {
      if (!this.refs.playerList) return;
      const players = Array.from(this.players.values());
      this.refs.playerCount.textContent = `${players.length} player${players.length === 1 ? "" : "s"}`;
      this.refs.playerList.replaceChildren();
      if (!players.length) {
        const empty = document.createElement("div");
        empty.className = "gmp-muted";
        empty.textContent = "No players yet.";
        this.refs.playerList.appendChild(empty);
        return;
      }
      players.forEach((player) => {
        const row = document.createElement("div");
        row.className = "gmp-player";
        const left = document.createElement("div");
        left.textContent = player.username || "Player";
        const right = document.createElement("div");
        right.className = "gmp-row";
        if (player.isOwner) {
          const badge = document.createElement("span");
          badge.className = "gmp-badge";
          badge.textContent = "OWNER";
          right.appendChild(badge);
        }
        const status = document.createElement("span");
        status.className = "gmp-muted";
        status.textContent = player.connected === false ? "reconnecting" : (player.gameVersion || "");
        right.appendChild(status);
        row.append(left, right);
        this.refs.playerList.appendChild(row);
      });
    }

    setUsername(username) {
      this.username = username;
      this.refs.username.value = username;
    }

    toast(message) {
      if (!message) return;
      this.refs.toast.textContent = message;
      this.refs.toast.style.display = "block";
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => { this.refs.toast.style.display = "none"; }, 2600);
    }

    copy(value, successMessage) {
      if (!value) return;
      navigator.clipboard?.writeText(value).then(() => this.toast(successMessage)).catch(() => this.toast(value));
    }

    emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail }));
    }

    destroy() {
      this.root?.remove();
      this.panel?.remove();
      this.refs.backdrop?.remove();
      this.refs.toast?.remove();
    }
  }

  Object.assign(ns, { GhostyUI });
})(globalThis);

(function (root) {
  "use strict";
  const ns = root.GMPInternal;

  class GhostysMultiplayerApp {
    constructor(runtime, gameVersion) {
      this.runtime = runtime;
      this.gameVersion = gameVersion;
      this.playerId = localStorage.getItem(ns.STORAGE_KEYS.playerId) || ns.randomId();
      localStorage.setItem(ns.STORAGE_KEYS.playerId, this.playerId);
      this.resumeToken = localStorage.getItem(ns.STORAGE_KEYS.resumeToken) || ns.randomId();
      localStorage.setItem(ns.STORAGE_KEYS.resumeToken, this.resumeToken);
      this.username = localStorage.getItem(ns.STORAGE_KEYS.username) || "OvO Player";
      this.room = null;
      this.players = new Map();
      this.buffers = new Map();
      this.lastLayout = runtime.running_layout && runtime.running_layout.name;
      this.sendTimer = null;
      this.destroyed = false;

      this.adapter = new ns.OvO144Adapter(runtime);
      this.ui = new ns.GhostyUI({ username: this.username });
      this.socket = null;
      this.bindUi();
      this.connectSocket();
      this.runtime.tickMe(this);
      this.startStateLoop();
      this.applyInviteFromUrl();
    }

    bindUi() {
      this.ui.addEventListener("save_username", (e) => {
        const username = this.cleanUsername(e.detail.username);
        if (!username) return this.ui.toast("Username must be 1–20 characters");
        this.username = username;
        localStorage.setItem(ns.STORAGE_KEYS.username, username);
        this.ui.setUsername(username);
        this.socket?.setUsername(username);
        this.ui.toast("Username saved");
      });
      this.ui.addEventListener("create_room", () => this.socket?.send("create_room", { mode: "freeplay", visibility: "private", maxPlayers: 8 }));
      this.ui.addEventListener("join_room", (e) => {
        const code = String(e.detail.roomCode || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) return this.ui.toast("Enter a 6-character room code");
        this.socket?.send("join_room", { roomCode: code });
      });
      this.ui.addEventListener("leave_room", () => this.socket?.send("leave_room", {}));
    }

    cleanUsername(value) {
      const username = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
      return username.length >= 1 && username.length <= 20 ? username : null;
    }

    connectSocket(force = false) {
      if (this.socket && force) this.socket.disconnect();
      if (this.socket && !force) return;
      this.socket = new ns.PeerRoomTransport({
        playerId: this.playerId,
        username: this.username,
        gameVersion: this.gameVersion
      });
      this.bindSocket(this.socket);
      this.socket.connect();
    }

    bindSocket(socket) {
      socket.addEventListener("status", (e) => this.ui.setConnectionState(e.detail.state));
      socket.addEventListener("ping", (e) => this.ui.setPing(e.detail.pingMs));
      socket.addEventListener("hello_ack", () => {});
      socket.addEventListener("room_joined", (e) => this.handleRoomJoined(e.detail));
      socket.addEventListener("room_left", () => this.handleRoomLeft());
      socket.addEventListener("player_joined", (e) => {
        const player = e.detail.player;
        if (!player) return;
        this.players.set(player.playerId, player);
        this.ui.upsertPlayer(player);
        if (player.playerId !== this.playerId) this.ui.toast(`${player.username} joined`);
      });
      socket.addEventListener("player_left", (e) => {
        const id = e.detail.playerId;
        const player = this.players.get(id);
        this.removeRemotePlayer(id);
        this.players.delete(id);
        this.ui.removePlayer(id);
        if (player && id !== this.playerId) this.ui.toast(`${player.username} left`);
      });
      socket.addEventListener("player_connection", (e) => {
        const player = this.players.get(e.detail.playerId);
        if (player) {
          player.connected = e.detail.connected;
          this.ui.upsertPlayer(player);
        }
      });
      socket.addEventListener("profile_updated", (e) => {
        const player = this.players.get(e.detail.playerId);
        if (player) {
          player.username = e.detail.username;
          this.ui.upsertPlayer(player);
        }
      });
      socket.addEventListener("owner_changed", (e) => {
        if (!this.room) return;
        this.room.ownerId = e.detail.ownerId;
        for (const player of this.players.values()) player.isOwner = player.playerId === e.detail.ownerId;
        this.ui.setPlayers(Array.from(this.players.values()));
      });
      socket.addEventListener("player_state", (e) => this.handlePlayerState(e.detail));
      socket.addEventListener("error", (e) => this.ui.toast(e.detail.message || "Multiplayer error"));
    }

    handleRoomJoined(message) {
      this.room = message.room;
      this.players = new Map((message.players || []).map((p) => [p.playerId, p]));
      this.ui.setRoom(this.room);
      this.ui.setPlayers(Array.from(this.players.values()));
      const url = new URL(location.href);
      url.searchParams.set("gmpRoom", this.room.code);
      history.replaceState({}, "", url);
      if (!message.resumed) this.ui.toast(`Joined ${this.room.code}`);
    }

    handleRoomLeft() {
      this.room = null;
      this.players.clear();
      for (const id of Array.from(this.buffers.keys())) this.removeRemotePlayer(id);
      this.ui.setRoom(null);
      this.ui.setPlayers([]);
      const url = new URL(location.href);
      url.searchParams.delete("gmpRoom");
      history.replaceState({}, "", url);
    }

    handlePlayerState(message) {
      if (!message || message.playerId === this.playerId || !message.state) return;
      if (!message.state.active) {
        this.removeRemotePlayer(message.playerId);
        return;
      }
      let buffer = this.buffers.get(message.playerId);
      if (!buffer) {
        buffer = new ns.SnapshotBuffer({ interpolationDelayMs: 100, maxSnapshots: 16 });
        this.buffers.set(message.playerId, buffer);
      }
      buffer.push({ ...message.state, username: message.username || message.state.username });
    }

    startStateLoop() {
      clearInterval(this.sendTimer);
      this.sendTimer = setInterval(() => {
        if (this.destroyed || !this.room) return;
        const state = this.adapter.getLocalState(this.username);
        this.socket?.send("player_state", { state });
      }, 40);
    }

    tick() {
      if (this.destroyed) return;
      const layout = this.adapter.currentLayout();
      if (layout !== this.lastLayout) {
        this.lastLayout = layout;
        this.adapter.destroyAllRemotePlayers();
      }
      const now = performance.now();
      for (const [playerId, buffer] of this.buffers.entries()) {
        const state = buffer.sample(now);
        if (state) this.adapter.updateRemotePlayer(playerId, state);
      }
    }

    removeRemotePlayer(playerId) {
      this.buffers.delete(playerId);
      this.adapter.destroyRemotePlayer(playerId);
    }

    applyInviteFromUrl() {
      const code = new URL(location.href).searchParams.get("gmpRoom");
      if (code && /^[A-Za-z0-9]{6}$/.test(code)) {
        this.ui.refs.roomCode.value = code.toUpperCase();
        this.ui.setOpen(true);
      }
    }

    destroy() {
      this.destroyed = true;
      clearInterval(this.sendTimer);
      this.socket?.disconnect();
      this.adapter.destroyAllRemotePlayers();
      this.ui.destroy();
    }
  }

  Object.assign(ns, { GhostysMultiplayerApp });
})(globalThis);

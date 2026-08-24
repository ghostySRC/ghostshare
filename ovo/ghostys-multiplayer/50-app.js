(function (root) {
  "use strict";
  const ns = root.GMPInternal;

  class GhostysMultiplayerApp {
    constructor(runtime, gameVersion) {
      this.runtime = runtime;
      this.gameVersion = gameVersion;
      // Keep a persistent profile id for future accounts/settings, but use a fresh
      // participant id for every page instance. localStorage is shared by tabs, so
      // using the persistent id as the room identity made a second tab look like a
      // duplicate player and the host rejected it.
      this.profileId = localStorage.getItem(ns.STORAGE_KEYS.playerId) || ns.randomId();
      localStorage.setItem(ns.STORAGE_KEYS.playerId, this.profileId);
      this.playerId = ns.randomId();
      this.resumeToken = ns.randomId();
      this.username = localStorage.getItem(ns.STORAGE_KEYS.username) || "OvO Player";
      this.friendCode = ns.cleanFriendCode(localStorage.getItem(ns.STORAGE_KEYS.friendCode));
      if (this.friendCode.length < 6) {
        this.friendCode = ns.randomFriendCode();
        localStorage.setItem(ns.STORAGE_KEYS.friendCode, this.friendCode);
      }
      this.friends = ns.safeJsonParse(localStorage.getItem(ns.STORAGE_KEYS.friends), []);
      if (!Array.isArray(this.friends)) this.friends = [];
      this.friends = Array.from(new Set(this.friends
        .map((friend) => ns.cleanFriendCode(friend && friend.friendCode))
        .filter((code) => code.length >= 6 && code !== this.friendCode)))
        .slice(0, 100)
        .map((friendCode) => ({ friendCode }));
      this.presences = [];
      this.publicRooms = [];
      this.room = null;
      this.players = new Map();
      this.buffers = new Map();
      this.lastLayout = runtime.running_layout && runtime.running_layout.name;
      this.sendTimer = null;
      this.destroyed = false;
      this.race = null;

      this.adapter = new ns.OvO144Adapter(runtime);
      this.ui = new ns.GhostyUI({ username: this.username, playerId: this.playerId, layouts: this.adapter.listRaceLayouts() });
      this.ui.setFriendCode(this.friendCode);
      this.ui.setFriends(this.friends, []);
      this.socket = null;
      this.directory = new ns.PeerDirectory({ playerId: this.playerId, friendCode: this.friendCode, username: this.username });
      this.bindDirectory();
      this.directory.setWatching(this.friends.map((friend) => friend.friendCode));
      this.directory.connect();
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
        this.directory?.setProfile(username, this.friendCode);
        this.updateDirectoryPresence();
        if (this.room) this.adapter.updateLocalPlayerLabel(username);
        this.ui.toast("Username saved");
      });
      this.ui.addEventListener("create_room", (e) => this.socket?.send("create_room", {
        mode: e.detail.mode === "race" ? "race" : "freeplay",
        visibility: e.detail.visibility === "public" ? "public" : "private",
        layout: e.detail.layout || "",
        maxPlayers: 8
      }));
      this.ui.addEventListener("join_room", (e) => {
        const code = String(e.detail.roomCode || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) return this.ui.toast("Enter a 6-character room code");
        this.socket?.send("join_room", { roomCode: code });
      });
      this.ui.addEventListener("leave_room", () => this.socket?.send("leave_room", {}));
      this.ui.addEventListener("start_race", (e) => {
        if (!this.room || this.room.mode !== "race") return this.ui.toast("Create or join a Race room first");
        if (this.room.ownerId !== this.playerId) return this.ui.toast("Only the room owner can start the race");
        this.socket?.send("start_race", { layout: e.detail.layout, countdownMs: 3000 });
      });
      this.ui.addEventListener("refresh_rooms", () => this.directory?.refresh());
      this.ui.addEventListener("add_friend", (e) => this.addFriend(e.detail.friendCode));
      this.ui.addEventListener("remove_friend", (e) => this.removeFriend(e.detail.friendCode));
    }

    bindDirectory() {
      this.directory.addEventListener("snapshot", (e) => {
        this.publicRooms = (e.detail.rooms || []).filter((room) => room.code !== this.room?.code);
        this.presences = e.detail.presences || [];
        this.ui.setPublicRooms(this.publicRooms);
        this.ui.setFriends(this.friends, this.presences);
      });
      this.directory.addEventListener("status", (e) => this.ui.setDirectoryState(e.detail.state));
      this.directory.addEventListener("error", (e) => console.warn("[GMP] Directory:", e.detail.message));
    }

    addFriend(rawCode) {
      const friendCode = ns.cleanFriendCode(rawCode);
      if (friendCode.length < 6) return this.ui.toast("Enter a valid friend code");
      if (friendCode === this.friendCode) return this.ui.toast("That is your own friend code");
      if (this.friends.some((friend) => friend.friendCode === friendCode)) return this.ui.toast("Friend is already added");
      this.friends.push({ friendCode });
      this.saveFriends();
      this.ui.toast("Friend added");
      this.directory.refresh();
    }

    removeFriend(friendCode) {
      this.friends = this.friends.filter((friend) => friend.friendCode !== friendCode);
      this.saveFriends();
    }

    saveFriends() {
      localStorage.setItem(ns.STORAGE_KEYS.friends, JSON.stringify(this.friends));
      this.ui.setFriends(this.friends, this.presences);
      this.directory?.setWatching(this.friends.map((friend) => friend.friendCode));
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
        this.updateDirectoryPresence();
      });
      socket.addEventListener("player_left", (e) => {
        const id = e.detail.playerId;
        const player = this.players.get(id);
        this.removeRemotePlayer(id);
        this.players.delete(id);
        this.ui.removePlayer(id);
        if (player && id !== this.playerId) this.ui.toast(`${player.username} left`);
        this.updateDirectoryPresence();
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
          this.adapter.updateRemoteUsername(e.detail.playerId, e.detail.username);
        }
      });
      socket.addEventListener("owner_changed", (e) => {
        if (!this.room) return;
        this.room.ownerId = e.detail.ownerId;
        for (const player of this.players.values()) player.isOwner = player.playerId === e.detail.ownerId;
        this.ui.setPlayers(Array.from(this.players.values()));
      });
      socket.addEventListener("player_state", (e) => this.handlePlayerState(e.detail));
      socket.addEventListener("race_started", (e) => this.handleRaceStarted(e.detail));
      socket.addEventListener("race_results", (e) => {
        if (this.race && e.detail.raceId === this.race.raceId) this.race.results = e.detail.results || [];
        this.ui.setRaceResults(e.detail.results || []);
      });
      socket.addEventListener("error", (e) => this.ui.toast(e.detail.message || "Multiplayer error"));
    }

    handleRoomJoined(message) {
      for (const id of Array.from(this.buffers.keys())) this.removeRemotePlayer(id);
      this.adapter.destroyAllRemotePlayers();
      this.room = message.room;
      this.adapter.setMultiplayerActive(true);
      this.players = new Map((message.players || []).map((p) => [p.playerId, p]));
      this.ui.setRoom(this.room);
      this.ui.setPlayers(Array.from(this.players.values()));
      if (this.room.mode === "race") this.ui.showTab("race");
      this.updateDirectoryPresence();
      const url = new URL(location.href);
      url.searchParams.set("gmpRoom", this.room.code);
      if (this.socket?.isHost) url.searchParams.delete("gmpAutoJoin");
      else url.searchParams.set("gmpAutoJoin", "1");
      history.replaceState({}, "", url);
      this.adapter.updateLocalPlayerLabel(this.username);
      if (!message.resumed) this.ui.toast(`Joined ${this.room.code}`);
    }

    handleRoomLeft() {
      this.room = null;
      this.players.clear();
      for (const id of Array.from(this.buffers.keys())) this.removeRemotePlayer(id);
      this.adapter.destroyAllRemotePlayers();
      this.adapter.setMultiplayerActive(false);
      this.ui.setRoom(null);
      this.ui.setPlayers([]);
      this.race = null;
      this.ui.setRaceState({ label: "READY", message: "Create or join a Race room first." });
      this.ui.setRaceResults([]);
      this.adapter.setLocalControlsEnabled(true);
      this.updateDirectoryPresence();
      const url = new URL(location.href);
      url.searchParams.delete("gmpRoom");
      url.searchParams.delete("gmpAutoJoin");
      history.replaceState({}, "", url);
    }

    handlePlayerState(message) {
      if (!message || message.playerId === this.playerId || !message.state) return;
      if (!message.state.active || !this.adapter.isPlayableLayout(message.state.layout)) {
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

    handleRaceStarted(session) {
      if (!session || !session.raceId || !/^Level \d+$/.test(String(session.layout || ""))) return;
      if (!this.adapter.listRaceLayouts().includes(session.layout)) {
        this.ui.toast(`Race level ${session.layout} is not available in this OvO build`);
        this.socket?.send("leave_room", {});
        return;
      }
      const suppliedCountdown = session.localCountdownMs == null ? session.countdownMs : session.localCountdownMs;
      const countdownMs = Math.max(0, Math.min(10000, Number(suppliedCountdown) || 0));
      this.race = {
        raceId: session.raceId,
        layout: session.layout,
        countdownEnd: performance.now() + countdownMs,
        startTime: 0,
        finished: false,
        finishWasOverlapping: false,
        results: Array.isArray(session.results) ? session.results : []
      };
      this.room.layout = session.layout;
      this.ui.setRoom(this.room);
      this.updateDirectoryPresence();
      this.ui.setRaceResults(this.race.results);
      this.ui.showTab("race");
      this.ui.setOpen(false);
      this.adapter.changeLayout(session.layout);
      this.ui.toast(`Race starting on ${session.layout}`);
    }

    updateDirectoryPresence() {
      const playerCount = this.players.size;
      this.directory?.setPresence({
        roomCode: this.room?.code || "",
        mode: this.room?.mode || "freeplay",
        visibility: this.room?.visibility || "private",
        playerCount
      });
      this.directory?.setHostedRoom(this.room && this.socket?.isHost ? {
        ...this.room,
        layout: this.room.mode === "freeplay" ? this.adapter.currentLayout() : this.room.layout,
        ownerUsername: this.username,
        playerCount
      } : null);
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
        for (const buffer of this.buffers.values()) buffer.clear();
        this.adapter.handleLayoutChange();
        this.updateDirectoryPresence();
      }
      if (this.room) {
        this.adapter.destroyBuiltInGhosts();
        if (this.adapter.isPlayableLayout(layout)) this.adapter.updateLocalPlayerLabel(this.username);
        else {
          this.adapter.destroyAllRemotePlayers();
          this.adapter.destroyLocalLabels();
        }
      }
      this.tickRace();
      const now = performance.now();
      if (!this.adapter.isPlayableLayout(layout)) return;
      for (const [playerId, buffer] of this.buffers.entries()) {
        if (buffer.isStale(now, 2500)) {
          this.adapter.destroyRemotePlayer(playerId);
          buffer.clear();
          continue;
        }
        const state = buffer.sample(now);
        if (state) this.adapter.updateRemotePlayer(playerId, state);
      }
    }

    tickRace() {
      const race = this.race;
      if (!race || !this.room || this.room.mode !== "race") return;
      const now = performance.now();
      const remaining = race.countdownEnd - now;
      if (remaining > 0) {
        this.adapter.setLocalControlsEnabled(false);
        this.ui.setRaceState({ label: String(Math.ceil(remaining / 1000)), message: `${race.layout} starts in…` });
        return;
      }
      if (!race.startTime) {
        race.startTime = now;
        this.adapter.setLocalControlsEnabled(true);
        this.ui.setRaceState({ label: "GO!", message: `Race in progress on ${race.layout}` });
      }
      if (race.finished || this.adapter.currentLayout() !== race.layout) return;
      const overlapping = this.adapter.isAtFinish();
      if (overlapping && !race.finishWasOverlapping) {
        race.finished = true;
        const timeMs = Math.max(0, Math.round(now - race.startTime));
        this.socket?.send("finish_race", { raceId: race.raceId, timeMs });
        this.ui.setRaceState({ label: this.ui.formatTime(timeMs), message: "Finished! Waiting for the other racers." });
        this.ui.toast(`Finished in ${this.ui.formatTime(timeMs)}`);
      }
      race.finishWasOverlapping = overlapping;
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
        if (new URL(location.href).searchParams.get("gmpAutoJoin") === "1") {
          this.socket?.send("join_room", { roomCode: code.toUpperCase() });
        }
      }
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      clearInterval(this.sendTimer);
      try { this.runtime.untickMe(this); } catch (_) {}
      this.socket?.disconnect();
      this.directory?.destroy();
      this.adapter.setLocalControlsEnabled(true);
      this.adapter.destroyAllRemotePlayers();
      this.adapter.setMultiplayerActive(false);
      this.adapter.destroyLocalLabels();
      this.ui.destroy();
    }
  }

  Object.assign(ns, { GhostysMultiplayerApp });
})(globalThis);

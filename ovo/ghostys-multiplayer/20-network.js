(function (root) {
  "use strict";
  const ns = root.GMPInternal;

  const ROOM_ALPHABET = "6789BCDFGHJKLMNPQRTWXYZ";
  const PEER_PREFIX = "gmp-";

  function cleanUsername(value) {
    const username = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return username.length >= 1 && username.length <= 20 ? username : "OvO Player";
  }

  function randomRoomCode() {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
    return out;
  }

  function loadPeerJs() {
    if (root.Peer) return Promise.resolve(root.Peer);
    if (ns.peerJsPromise) return ns.peerJsPromise;
    ns.peerJsPromise = new Promise((resolve, reject) => {
      const existing = document.getElementById("gmp-peerjs");
      const script = existing || document.createElement("script");
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (!error && root.Peer) return resolve(root.Peer);
        ns.peerJsPromise = null;
        script.remove();
        reject(error || new Error("PeerJS loaded but window.Peer is missing"));
      };
      const timeout = setTimeout(() => finish(new Error("PeerJS took too long to load")), 12000);
      script.addEventListener("load", () => finish(null), { once: true });
      script.addEventListener("error", () => finish(new Error("Could not load OvO's bundled PeerJS library")), { once: true });
      if (!existing) {
        script.id = "gmp-peerjs";
        const versionPath = location.pathname.match(/^(.*\/1\.4\.4)(?:\/|$)/);
        script.src = versionPath
          ? new URL(`${versionPath[1]}/peerjs.min.js`, location.origin).href
          : new URL("./peerjs.min.js", location.href).href;
        document.head.appendChild(script);
      } else if (root.Peer) {
        finish(null);
      }
    });
    return ns.peerJsPromise;
  }

  class PeerRoomTransport extends EventTarget {
    constructor(options) {
      super();
      this.playerId = options.playerId;
      this.username = cleanUsername(options.username);
      this.gameVersion = options.gameVersion;
      this.peer = null;
      this.hostConnection = null;
      this.connections = new Map();
      this.players = new Map();
      this.room = null;
      this.isHost = false;
      this.intentionalClose = false;
      this.ready = false;
      this.roomGenerationAttempt = 0;
      this.pingNonce = null;
      this.pingStartedAt = 0;
      this.pingTimer = null;
      this.lastPingMs = null;
      this.clockOffsetMs = 0;
      this.raceSession = null;
    }

    async connect() {
      this.intentionalClose = false;
      this.dispatch("status", { state: "connecting" });
      try {
        await loadPeerJs();
        this.ready = true;
        this.dispatch("hello_ack", { resumed: false, transport: "peerjs" });
        this.dispatch("status", { state: "online" });
      } catch (error) {
        this.dispatch("status", { state: "offline" });
        this.dispatch("error", { message: error.message || "Could not initialize multiplayer" });
      }
    }

    disconnect() {
      this.intentionalClose = true;
      this.stopPing();
      this.closeRoomObjects();
      this.dispatch("status", { state: "offline" });
    }

    setUsername(username) {
      this.send("set_profile", { username });
    }

    send(type, payload = {}) {
      switch (type) {
        case "create_room":
          this.createRoom(payload);
          return true;
        case "join_room":
          this.joinRoom(payload.roomCode);
          return true;
        case "leave_room":
          this.leaveRoom();
          return true;
        case "set_profile":
          this.updateProfile(payload.username);
          return true;
        case "player_state":
          this.sendPlayerState(payload.state);
          return true;
        case "start_race":
          return this.startRace(payload);
        case "finish_race":
          return this.finishRace(payload);
        default:
          return false;
      }
    }

    async createRoom(options = {}) {
      if (!this.ready) await this.connect();
      if (!root.Peer) return;
      this.leaveRoom(false);
      this.isHost = true;
      this.roomGenerationAttempt = 0;
      this.openHostPeer(options);
    }

    openHostPeer(options = {}) {
      const code = randomRoomCode();
      const peer = new root.Peer(PEER_PREFIX + code);
      let announced = false;
      this.peer = peer;
      this.room = {
        code,
        ownerId: this.playerId,
        mode: options.mode === "race" ? "race" : "freeplay",
        visibility: options.visibility === "public" ? "public" : "private",
        maxPlayers: Math.max(2, Math.min(8, Number(options.maxPlayers) || 8)),
        layout: /^Level \d+$/.test(String(options.layout || "")) ? String(options.layout) : "",
        transport: "peerjs"
      };
      this.players = new Map([[this.playerId, this.selfProfile(true)]]);

      peer.on("open", () => {
        if (this.peer !== peer) return;
        this.roomGenerationAttempt = 0;
        if (!announced) {
          announced = true;
          this.dispatch("room_joined", {
            resumed: false,
            room: { ...this.room },
            players: Array.from(this.players.values())
          });
        }
        this.dispatch("status", { state: "online" });
        this.dispatch("ping", { pingMs: 0 });
      });

      peer.on("connection", (conn) => this.acceptConnection(conn));
      peer.on("error", (error) => {
        if (error && error.type === "unavailable-id" && this.roomGenerationAttempt < 5) {
          this.roomGenerationAttempt += 1;
          try { peer.destroy(); } catch (_) {}
          this.openHostPeer(options);
          return;
        }
        this.dispatch("error", { message: this.describePeerError(error) });
      });
      peer.on("disconnected", () => {
        this.recoverPeer(peer);
      });
    }

    acceptConnection(conn) {
      if (!this.isHost || !this.room) {
        try { conn.close(); } catch (_) {}
        return;
      }
      const entry = { conn, playerId: null, openedAt: performance.now() };
      const onClose = () => this.dropConnection(entry, "disconnected");
      conn.on("open", () => {});
      conn.on("data", (message) => this.handleHostMessage(entry, message));
      conn.on("close", onClose);
      conn.on("error", onClose);
    }

    handleHostMessage(entry, message) {
      if (!message || typeof message !== "object" || typeof message.t !== "string") return;
      if (message.t === "join") {
        if (entry.playerId) return;
        if (this.room.mode === "race" && Number(message.protocolVersion) !== ns.PROTOCOL_VERSION) {
          this.safeSend(entry.conn, { t: "reject", message: "This Race room needs the latest GMP update" });
          setTimeout(() => { try { entry.conn.close(); } catch (_) {} }, 30);
          return;
        }
        if (this.isRaceActive()) {
          this.safeSend(entry.conn, { t: "reject", message: "Race is already in progress" });
          setTimeout(() => { try { entry.conn.close(); } catch (_) {} }, 30);
          return;
        }
        if (this.players.size >= this.room.maxPlayers) {
          this.safeSend(entry.conn, { t: "reject", message: "Room is full" });
          setTimeout(() => { try { entry.conn.close(); } catch (_) {} }, 30);
          return;
        }
        const playerId = String(message.playerId || "").slice(0, 80);
        if (!playerId || playerId === this.playerId || this.players.has(playerId)) {
          this.safeSend(entry.conn, { t: "reject", message: "Player identity is already in this room" });
          setTimeout(() => { try { entry.conn.close(); } catch (_) {} }, 30);
          return;
        }
        entry.playerId = playerId;
        this.connections.set(playerId, entry);
        const player = {
          playerId,
          username: cleanUsername(message.username),
          gameVersion: String(message.gameVersion || "unknown").slice(0, 24),
          connected: true,
          isOwner: false
        };
        this.players.set(playerId, player);
        this.safeSend(entry.conn, {
          t: "welcome",
          room: { ...this.room },
          players: Array.from(this.players.values()),
          raceSession: this.isRaceActive() ? this.raceSession : null
        });
        this.broadcast({ t: "player_joined", player }, playerId);
        this.dispatch("player_joined", { player });
        return;
      }
      if (!entry.playerId) return;
      if (message.t === "state") {
        const state = this.sanitizeState(message.state);
        if (!state) return;
        const player = this.players.get(entry.playerId);
        const packet = { t: "player_state", playerId: entry.playerId, username: player?.username || "Player", state };
        this.broadcast(packet, entry.playerId);
        this.dispatch("player_state", packet);
      } else if (message.t === "profile") {
        const player = this.players.get(entry.playerId);
        if (!player) return;
        player.username = cleanUsername(message.username);
        const packet = { t: "profile_updated", playerId: entry.playerId, username: player.username };
        this.broadcast(packet);
        this.dispatch("profile_updated", packet);
      } else if (message.t === "ping") {
        this.safeSend(entry.conn, { t: "pong", nonce: message.nonce, serverTime: Date.now() });
      } else if (message.t === "race_finish") {
        this.recordRaceFinish(entry.playerId, message);
      } else if (message.t === "leave") {
        try { entry.conn.close(); } catch (_) {}
      }
    }

    async joinRoom(code) {
      if (!this.ready) await this.connect();
      if (!root.Peer) return;
      const roomCode = String(code || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
        this.dispatch("error", { message: "Enter a valid 6-character room code" });
        return;
      }
      this.leaveRoom(false);
      this.isHost = false;
      this.room = { code: roomCode, ownerId: null, mode: "freeplay", visibility: "private", maxPlayers: 8, transport: "peerjs" };
      const peer = new root.Peer();
      this.peer = peer;
      peer.on("open", () => {
        if (this.peer !== peer) return;
        if (this.hostConnection?.open) this.dispatch("status", { state: "online" });
        else this.connectToHost(roomCode);
      });
      peer.on("error", (error) => {
        this.dispatch("error", { message: this.describePeerError(error, roomCode) });
        if (error && (error.type === "peer-unavailable" || error.type === "network")) this.leaveRoom(false);
      });
      peer.on("disconnected", () => {
        this.recoverPeer(peer);
      });
    }

    connectToHost(roomCode) {
      if (!this.peer || this.peer.destroyed) return;
      const conn = this.peer.connect(PEER_PREFIX + roomCode);
      this.hostConnection = conn;
      let welcomed = false;
      conn.on("open", () => {
        this.safeSend(conn, {
          t: "join",
          playerId: this.playerId,
          username: this.username,
          gameVersion: this.gameVersion,
          clientVersion: ns.CLIENT_VERSION,
          protocolVersion: ns.PROTOCOL_VERSION
        });
      });
      conn.on("data", (message) => {
        if (message?.t === "welcome") welcomed = true;
        this.handleClientMessage(message);
      });
      const onClose = () => {
        if (!this.room || this.intentionalClose) return;
        const message = welcomed ? "Host disconnected — the room has closed" : `Could not join room ${roomCode}`;
        this.dispatch("error", { message });
        this.leaveRoom(true);
      };
      conn.on("close", onClose);
      conn.on("error", onClose);
    }

    handleClientMessage(message) {
      if (!message || typeof message !== "object") return;
      if (message.t === "welcome") {
        this.room = { ...this.room, ...(message.room || {}) };
        this.players = new Map((message.players || []).map((p) => [p.playerId, p]));
        this.dispatch("room_joined", { resumed: false, room: { ...this.room }, players: Array.from(this.players.values()) });
        if (message.raceSession) {
          this.raceSession = this.localizeRaceSession(message.raceSession);
          this.dispatch("race_started", this.raceSession);
        }
        this.startPing();
      } else if (message.t === "reject") {
        this.dispatch("error", { message: message.message || "Could not join room" });
        this.leaveRoom(false);
      } else if (message.t === "player_joined") {
        if (message.player) this.players.set(message.player.playerId, message.player);
        this.dispatch("player_joined", { player: message.player });
      } else if (message.t === "player_left") {
        this.players.delete(message.playerId);
        this.dispatch("player_left", { playerId: message.playerId, reason: message.reason || "left" });
      } else if (message.t === "profile_updated") {
        const player = this.players.get(message.playerId);
        if (player) player.username = message.username;
        this.dispatch("profile_updated", { playerId: message.playerId, username: message.username });
      } else if (message.t === "player_state") {
        this.dispatch("player_state", message);
      } else if (message.t === "race_start") {
        this.raceSession = this.localizeRaceSession(message.session || {});
        this.dispatch("race_started", this.raceSession);
      } else if (message.t === "race_results") {
        if (this.raceSession && this.raceSession.raceId === message.raceId) this.raceSession.results = message.results;
        this.dispatch("race_results", { raceId: message.raceId, results: Array.isArray(message.results) ? message.results : [] });
      } else if (message.t === "pong" && message.nonce === this.pingNonce) {
        this.lastPingMs = Math.max(0, Math.round(performance.now() - this.pingStartedAt));
        if (Number.isFinite(Number(message.serverTime))) {
          this.clockOffsetMs = Number(message.serverTime) + this.lastPingMs / 2 - Date.now();
        }
        this.dispatch("ping", { pingMs: this.lastPingMs });
      }
    }

    updateProfile(username) {
      this.username = cleanUsername(username);
      if (!this.room) return;
      if (this.isHost) {
        const self = this.players.get(this.playerId);
        if (self) self.username = this.username;
        const packet = { t: "profile_updated", playerId: this.playerId, username: this.username };
        this.broadcast(packet);
        this.dispatch("profile_updated", packet);
      } else if (this.hostConnection) {
        this.safeSend(this.hostConnection, { t: "profile", username: this.username });
      }
    }

    sendPlayerState(rawState) {
      if (!this.room) return;
      const state = this.sanitizeState(rawState);
      if (!state) return;
      if (this.isHost) {
        const packet = { t: "player_state", playerId: this.playerId, username: this.username, state };
        this.broadcast(packet);
      } else if (this.hostConnection) {
        this.safeSend(this.hostConnection, { t: "state", state });
      }
    }

    startRace(options = {}) {
      if (!this.room || !this.isHost || this.room.mode !== "race") return false;
      const layout = /^Level \d+$/.test(String(options.layout || "")) ? String(options.layout) : "Level 1";
      const countdownMs = Math.max(1000, Math.min(10000, Number(options.countdownMs) || 3000));
      this.room.layout = layout;
      this.raceSession = {
        raceId: ns.randomId(),
        layout,
        countdownMs,
        startedAt: Date.now(),
        startAt: Date.now() + countdownMs,
        participantIds: Array.from(this.players.keys()),
        results: []
      };
      const session = { ...this.raceSession, participantIds: this.raceSession.participantIds.slice(), results: [], localCountdownMs: countdownMs };
      this.broadcast({ t: "race_start", session });
      this.dispatch("race_started", session);
      return true;
    }

    finishRace(payload = {}) {
      if (!this.room || this.room.mode !== "race" || !this.raceSession) return false;
      if (this.isHost) return this.recordRaceFinish(this.playerId, payload);
      return this.safeSend(this.hostConnection, {
        t: "race_finish",
        raceId: String(payload.raceId || ""),
        timeMs: Number(payload.timeMs)
      });
    }

    recordRaceFinish(playerId, payload = {}) {
      const race = this.raceSession;
      if (!race || String(payload.raceId || "") !== race.raceId) return false;
      if (!Array.isArray(race.participantIds) || !race.participantIds.includes(playerId)) return false;
      if (race.results.some((result) => result.playerId === playerId)) return false;
      const timeMs = Math.max(0, Math.min(3600000, Math.round(Number(payload.timeMs))));
      if (!Number.isFinite(timeMs)) return false;
      const player = this.players.get(playerId);
      const result = {
        playerId,
        username: player?.username || "Player",
        timeMs,
        placement: race.results.length + 1
      };
      race.results.push(result);
      const packet = { t: "race_results", raceId: race.raceId, results: race.results.slice() };
      this.broadcast(packet);
      this.dispatch("race_results", packet);
      return true;
    }

    isRaceActive() {
      const race = this.raceSession;
      return !!(this.room?.mode === "race" && race && Array.isArray(race.participantIds) &&
        race.results.length < race.participantIds.length);
    }

    localizeRaceSession(session) {
      const startAt = Number(session.startAt);
      const fallback = Math.max(0, Math.min(10000, Number(session.countdownMs) || 0));
      const localCountdownMs = Number.isFinite(startAt)
        ? Math.max(0, Math.min(10000, startAt - (Date.now() + this.clockOffsetMs)))
        : fallback;
      return { ...session, localCountdownMs };
    }

    sanitizeState(state) {
      if (!state || typeof state !== "object") return null;
      const movementState = typeof state.state === "string"
        ? state.state.slice(0, 32)
        : (Number.isFinite(Number(state.state)) ? Number(state.state) : 0);
      const out = {
        active: !!state.active,
        layout: String(state.layout || "").slice(0, 80),
        layer: String(state.layer || "Game").slice(0, 80),
        username: cleanUsername(state.username || this.username),
        skin: String(state.skin || "").slice(0, 80),
        state: movementState,
        side: Number.isFinite(Number(state.side)) ? Number(state.side) : 1,
        frame: Number.isFinite(Number(state.frame)) ? Number(state.frame) : 0,
        angle: Number.isFinite(Number(state.angle)) ? Number(state.angle) : 0
      };
      if (out.active) {
        out.x = Number(state.x);
        out.y = Number(state.y);
        if (!Number.isFinite(out.x) || !Number.isFinite(out.y)) return null;
        out.x = ns.clamp(out.x, -1000000, 1000000);
        out.y = ns.clamp(out.y, -1000000, 1000000);
        if (Array.isArray(state.pose)) {
          out.pose = state.pose.slice(0, 16).map((part) => {
            if (!Array.isArray(part)) return null;
            const values = part.slice(0, 7).map(Number);
            if (values.slice(0, 5).some((value) => !Number.isFinite(value))) return null;
            return [
              ns.clamp(values[0], -10000, 10000),
              ns.clamp(values[1], -10000, 10000),
              ns.clamp(values[2], -Math.PI * 8, Math.PI * 8),
              ns.clamp(values[3], -10000, 10000),
              ns.clamp(values[4], -10000, 10000),
              Number.isFinite(values[5]) ? ns.clamp(Math.round(values[5]), 0, 1000) : 0,
              values[6] ? 1 : 0
            ];
          }).filter(Boolean);
        }
      }
      return out;
    }

    dropConnection(entry, reason) {
      const playerId = entry && entry.playerId;
      if (!playerId || !this.connections.has(playerId)) return;
      this.connections.delete(playerId);
      this.players.delete(playerId);
      if (this.raceSession && Array.isArray(this.raceSession.participantIds)) {
        this.raceSession.participantIds = this.raceSession.participantIds.filter((id) => id !== playerId);
      }
      const packet = { t: "player_left", playerId, reason };
      this.broadcast(packet);
      this.dispatch("player_left", packet);
    }

    leaveRoom(emit = true) {
      const hadRoom = !!this.room;
      this.stopPing();
      if (!this.isHost && this.hostConnection) this.safeSend(this.hostConnection, { t: "leave" });
      this.closeRoomObjects();
      if (emit && hadRoom) this.dispatch("room_left", {});
    }

    closeRoomObjects() {
      for (const entry of this.connections.values()) {
        try { entry.conn.close(); } catch (_) {}
      }
      this.connections.clear();
      try { this.hostConnection?.close(); } catch (_) {}
      this.hostConnection = null;
      try { this.peer?.destroy(); } catch (_) {}
      this.peer = null;
      this.players.clear();
      this.room = null;
      this.isHost = false;
      this.raceSession = null;
    }

    selfProfile(isOwner) {
      return {
        playerId: this.playerId,
        username: this.username,
        gameVersion: this.gameVersion,
        connected: true,
        isOwner: !!isOwner
      };
    }

    broadcast(message, exceptPlayerId = null) {
      for (const [playerId, entry] of this.connections) {
        if (playerId === exceptPlayerId) continue;
        this.safeSend(entry.conn, message);
      }
    }

    safeSend(conn, message) {
      try {
        if (conn && conn.open) {
          conn.send(message);
          return true;
        }
      } catch (_) {}
      return false;
    }

    startPing() {
      this.stopPing();
      const run = () => {
        if (!this.hostConnection || !this.hostConnection.open) return;
        this.pingNonce = Math.random().toString(36).slice(2);
        this.pingStartedAt = performance.now();
        this.safeSend(this.hostConnection, { t: "ping", nonce: this.pingNonce });
      };
      run();
      this.pingTimer = setInterval(run, 3000);
    }

    stopPing() {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.pingNonce = null;
    }

    recoverPeer(peer) {
      if (this.intentionalClose || !this.room || this.peer !== peer || peer.destroyed) return;
      this.dispatch("status", { state: "reconnecting" });
      setTimeout(() => {
        if (this.intentionalClose || this.peer !== peer || peer.destroyed || !peer.disconnected) return;
        try { peer.reconnect(); } catch (_) {}
      }, 800 + Math.random() * 700);
    }

    describePeerError(error, roomCode = "") {
      if (!error) return "Multiplayer connection error";
      if (error.type === "peer-unavailable") return roomCode ? `Room ${roomCode} was not found` : "Room was not found";
      if (error.type === "network") return "PeerJS network connection failed";
      if (error.type === "browser-incompatible") return "This browser does not support WebRTC multiplayer";
      return error.message || `PeerJS error: ${error.type || "unknown"}`;
    }

    dispatch(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  Object.assign(ns, { PeerRoomTransport, randomRoomCode, cleanUsername, loadPeerJs });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { PeerRoomTransport, randomRoomCode, cleanUsername };
  }
})(globalThis);

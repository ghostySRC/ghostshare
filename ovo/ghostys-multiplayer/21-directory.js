(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  const DIRECTORY_ID = "gmp-public-directory-v3";
  const STALE_MS = 90000;

  function cleanFriendCode(value) {
    return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
  }

  function randomFriendCode() {
    const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }

  class PeerDirectory extends EventTarget {
    constructor(options = {}) {
      super();
      this.playerId = String(options.playerId || "");
      this.friendCode = cleanFriendCode(options.friendCode);
      this.username = ns.cleanUsername(options.username);
      this.peer = null;
      this.connection = null;
      this.clients = new Set();
      this.presences = new Map();
      this.rooms = new Map();
      this.presence = {};
      this.watching = [];
      this.watchLists = new Map();
      this.hostedRoom = null;
      this.isCoordinator = false;
      this.destroyed = false;
      this.retryTimer = null;
      this.heartbeatTimer = null;
      this.pruneTimer = null;
      this.generation = 0;
    }

    async connect() {
      if (this.destroyed) return;
      try {
        await ns.loadPeerJs();
        this.electCoordinator();
      } catch (error) {
        this.dispatch("error", { message: error.message || "Public directory unavailable" });
        this.scheduleRetry();
      }
    }

    electCoordinator() {
      if (this.destroyed || !root.Peer) return;
      const generation = ++this.generation;
      this.closePeer();
      const peer = new root.Peer(DIRECTORY_ID);
      this.peer = peer;
      const electionTimer = setTimeout(() => {
        if (generation === this.generation) this.scheduleRetry();
      }, 12000);
      peer.on("open", () => {
        clearTimeout(electionTimer);
        if (generation !== this.generation) return;
        this.isCoordinator = true;
        this.connection = null;
        this.startCoordinator();
        this.dispatch("status", { state: "online", coordinator: true });
      });
      peer.on("connection", (conn) => this.acceptClient(conn));
      peer.on("error", (error) => {
        clearTimeout(electionTimer);
        if (generation !== this.generation || this.destroyed) return;
        if (error && error.type === "unavailable-id") this.openClient(generation);
        else {
          this.dispatch("status", { state: "offline" });
          this.scheduleRetry();
        }
      });
      peer.on("disconnected", () => { clearTimeout(electionTimer); if (generation === this.generation) this.scheduleRetry(); });
    }

    openClient(previousGeneration) {
      if (previousGeneration !== this.generation || this.destroyed) return;
      const generation = ++this.generation;
      try { this.peer?.destroy(); } catch (_) {}
      const peer = new root.Peer();
      this.peer = peer;
      this.isCoordinator = false;
      peer.on("open", () => {
        if (generation !== this.generation) return;
        const conn = peer.connect(DIRECTORY_ID, { reliable: true });
        this.connection = conn;
        const connectTimer = setTimeout(() => {
          if (generation === this.generation && !conn.open) this.scheduleRetry();
        }, 10000);
        conn.on("open", () => {
          clearTimeout(connectTimer);
          if (generation !== this.generation) return;
          this.dispatch("status", { state: "online", coordinator: false });
          this.sendHeartbeat();
          this.startHeartbeat();
        });
        conn.on("data", (message) => { if (generation === this.generation) this.handleDirectoryMessage(message); });
        conn.on("close", () => { clearTimeout(connectTimer); if (generation === this.generation) this.scheduleRetry(); });
        conn.on("error", () => { clearTimeout(connectTimer); if (generation === this.generation) this.scheduleRetry(); });
      });
      peer.on("error", () => { if (generation === this.generation) this.scheduleRetry(); });
      peer.on("disconnected", () => { if (generation === this.generation) this.scheduleRetry(); });
    }

    startCoordinator() {
      clearInterval(this.pruneTimer);
      this.pruneTimer = setInterval(() => this.prune(), 4000);
      this.applyHeartbeat(this.buildHeartbeat(), null);
      this.startHeartbeat();
      this.publishSnapshot();
    }

    acceptClient(conn) {
      if (!this.isCoordinator || this.destroyed) return conn.close();
      this.clients.add(conn);
      conn.on("data", (message) => {
        if (message?.t === "directory_heartbeat") {
          conn.__gmpPlayerId = String(message.playerId || "").slice(0, 80);
          this.applyHeartbeat(message, conn);
        }
        if (message?.t === "directory_refresh") this.sendSnapshot(conn);
        if (message?.t === "directory_goodbye") this.removePlayer(String(message.playerId || ""));
      });
      let dropped = false;
      const drop = () => {
        if (dropped) return;
        dropped = true;
        this.clients.delete(conn);
        if (conn.__gmpPlayerId) this.removePlayer(conn.__gmpPlayerId);
      };
      conn.on("close", drop);
      conn.on("error", drop);
      conn.on("open", () => this.sendSnapshot(conn));
    }

    setProfile(username, friendCode) {
      this.username = ns.cleanUsername(username);
      this.friendCode = cleanFriendCode(friendCode) || this.friendCode;
      this.sendHeartbeat();
    }

    setWatching(friendCodes) {
      this.watching = Array.from(new Set((friendCodes || []).map(cleanFriendCode).filter((code) => code.length >= 6))).slice(0, 100);
      this.sendHeartbeat();
    }

    setPresence(presence = {}) {
      this.presence = {
        roomCode: String(presence.roomCode || "").toUpperCase().slice(0, 6),
        mode: presence.mode === "race" ? "race" : "freeplay",
        visibility: presence.visibility === "public" ? "public" : "private",
        playerCount: Math.max(0, Math.min(8, Number(presence.playerCount) || 0))
      };
      this.sendHeartbeat();
    }

    setHostedRoom(room) {
      this.hostedRoom = room && room.visibility === "public" ? {
        code: String(room.code || "").toUpperCase().slice(0, 6),
        mode: room.mode === "race" ? "race" : "freeplay",
        visibility: "public",
        maxPlayers: Math.max(2, Math.min(8, Number(room.maxPlayers) || 8)),
        playerCount: Math.max(1, Math.min(8, Number(room.playerCount) || 1)),
        ownerUsername: ns.cleanUsername(room.ownerUsername || this.username),
        layout: String(room.layout || "").slice(0, 80)
      } : null;
      this.sendHeartbeat();
    }

    refresh() {
      if (this.isCoordinator) return this.publishSnapshot();
      this.safeSend(this.connection, { t: "directory_refresh" });
      this.sendHeartbeat();
    }

    buildHeartbeat() {
      return {
        t: "directory_heartbeat",
        playerId: this.playerId,
        friendCode: this.friendCode,
        username: this.username,
        presence: this.presence,
        room: this.hostedRoom,
        watching: this.watching,
        sentAt: Date.now()
      };
    }

    sendHeartbeat() {
      if (this.destroyed || !this.friendCode) return;
      const message = this.buildHeartbeat();
      if (this.isCoordinator) this.applyHeartbeat(message, null);
      else this.safeSend(this.connection, message);
    }

    startHeartbeat() {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), 5000);
    }

    applyHeartbeat(message) {
      const now = Date.now();
      const playerId = String(message.playerId || "").slice(0, 80);
      const friendCode = cleanFriendCode(message.friendCode);
      if (!playerId || friendCode.length < 6) return;
      this.watchLists.set(playerId, new Set((message.watching || []).map(cleanFriendCode).filter((code) => code.length >= 6).slice(0, 100)));
      this.presences.set(playerId, {
        friendCode,
        playerId,
        username: ns.cleanUsername(message.username),
        roomCode: String(message.presence?.roomCode || "").toUpperCase().slice(0, 6),
        mode: message.presence?.mode === "race" ? "race" : "freeplay",
        visibility: message.presence?.visibility === "public" ? "public" : "private",
        playerCount: Math.max(0, Math.min(8, Number(message.presence?.playerCount) || 0)),
        seenAt: now
      });
      const roomCode = String(message.room?.code || "").toUpperCase();
      if (message.room && /^[A-Z0-9]{6}$/.test(roomCode)) {
        for (const [code, room] of this.rooms) {
          if (room.ownerId === playerId && code !== roomCode) this.rooms.delete(code);
        }
        this.rooms.set(roomCode, {
          code: roomCode,
          mode: message.room.mode === "race" ? "race" : "freeplay",
          visibility: "public",
          maxPlayers: Math.max(2, Math.min(8, Number(message.room.maxPlayers) || 8)),
          playerCount: Math.max(1, Math.min(8, Number(message.room.playerCount) || 1)),
          ownerUsername: ns.cleanUsername(message.room.ownerUsername),
          layout: String(message.room.layout || "").slice(0, 80),
          ownerId: playerId,
          seenAt: now
        });
      } else {
        for (const [code, room] of this.rooms) {
          if (room.ownerId === playerId) this.rooms.delete(code);
        }
      }
      this.publishSnapshot();
    }

    prune() {
      const cutoff = Date.now() - STALE_MS;
      for (const [key, value] of this.presences) if (value.seenAt < cutoff) this.presences.delete(key);
      for (const [key, value] of this.rooms) if (value.seenAt < cutoff) this.rooms.delete(key);
      this.publishSnapshot();
    }

    removePlayer(playerId) {
      if (!playerId) return;
      this.presences.delete(playerId);
      this.watchLists.delete(playerId);
      for (const [code, room] of this.rooms) if (room.ownerId === playerId) this.rooms.delete(code);
      this.publishSnapshot();
    }

    publishSnapshot() {
      this.handleDirectoryMessage(this.buildSnapshot(new Set(this.watching)));
      for (const conn of this.clients) {
        this.safeSend(conn, this.buildSnapshot(this.watchLists.get(conn.__gmpPlayerId) || new Set()));
      }
    }

    sendSnapshot(conn) {
      this.safeSend(conn, this.buildSnapshot(this.watchLists.get(conn.__gmpPlayerId) || new Set()));
    }

    buildSnapshot(watching) {
      const selected = new Map();
      for (const presence of this.presences.values()) {
        if (!watching.has(presence.friendCode)) continue;
        const current = selected.get(presence.friendCode);
        if (!current || (!current.roomCode && presence.roomCode) ||
          (!!current.roomCode === !!presence.roomCode && presence.seenAt > current.seenAt)) {
          selected.set(presence.friendCode, presence);
        }
      }
      return {
        t: "directory_snapshot",
        rooms: Array.from(this.rooms.values()).map(({ seenAt, ownerId, ...room }) => room),
        presences: Array.from(selected.values())
          .map(({ seenAt, playerId, ...presence }) => presence)
      };
    }

    handleDirectoryMessage(message) {
      if (message?.t !== "directory_snapshot") return;
      this.dispatch("snapshot", {
        rooms: Array.isArray(message.rooms) ? message.rooms : [],
        presences: Array.isArray(message.presences) ? message.presences : []
      });
    }

    scheduleRetry() {
      if (this.destroyed || this.retryTimer) return;
      this.retryTimer = 1;
      this.dispatch("status", { state: "reconnecting" });
      this.closePeer();
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.electCoordinator();
      }, 900 + Math.random() * 2200);
    }

    safeSend(conn, message) {
      try {
        if (conn?.open) { conn.send(message); return true; }
      } catch (_) {}
      return false;
    }

    closePeer() {
      clearInterval(this.pruneTimer);
      clearInterval(this.heartbeatTimer);
      this.pruneTimer = null;
      this.heartbeatTimer = null;
      for (const conn of this.clients) { try { conn.close(); } catch (_) {} }
      this.clients.clear();
      try { this.connection?.close(); } catch (_) {}
      try { this.peer?.destroy(); } catch (_) {}
      this.connection = null;
      this.peer = null;
      this.isCoordinator = false;
    }

    destroy() {
      this.destroyed = true;
      clearTimeout(this.retryTimer);
      if (!this.isCoordinator) this.safeSend(this.connection, { t: "directory_goodbye", playerId: this.playerId });
      this.closePeer();
    }

    dispatch(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail }));
    }
  }

  Object.assign(ns, { PeerDirectory, randomFriendCode, cleanFriendCode });
})(globalThis);

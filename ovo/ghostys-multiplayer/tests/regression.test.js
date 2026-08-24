"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const source = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

global.location = new URL("https://example.test/ovo/1.4.4/");
global.history = { replaceState() {} };
global.alert = () => {};
Object.defineProperty(global, "navigator", {
  configurable: true,
  value: { clipboard: { writeText: async () => {} } }
});
global.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; },
  setItem(key, value) { this.values.set(key, String(value)); }
};

function Sprite() {}
function TextModded() {}
function Globals() {}
function Arr() {}
function SkymenSkin() {}
Sprite.prototype.acts = {
  SetAnimFrame(frame) { this.cur_frame = frame; },
  SetAnim() {},
  SetAnimSpeed() {},
  SetCollisions() {}
};
SkymenSkin.prototype.acts = {
  SetSkin(skin) { this.default = false; this.skinTag = skin; },
  UseDefault() { this.default = true; if (typeof this.destroy === "function") this.destroy(); }
};
global.cr = {
  plugins_: { Sprite, TextModded, Globals, Arr },
  behaviors: { SkymenSkin },
  SkymenSkinCore: {}
};

global.GMPInternal = {};
for (const name of [
  "00-namespace.js",
  "10-snapshot-buffer.js",
  "20-network.js",
  "21-directory.js",
  "30-adapter-1.4.4.js",
  "31-render-fix.js",
  "40-ui.js",
  "50-app.js"
]) require(path.join(ROOT, name));

const ns = global.GMPInternal;

class FakeClassList {
  constructor(element) { this.element = element; }
  values() { return new Set(String(this.element.className || "").split(/\s+/).filter(Boolean)); }
  toggle(name, force) {
    const values = this.values();
    const enabled = force == null ? !values.has(name) : !!force;
    if (enabled) values.add(name); else values.delete(name);
    this.element.className = Array.from(values).join(" ");
    return enabled;
  }
  add(name) { this.toggle(name, true); }
  remove(name) { this.toggle(name, false); }
  contains(name) { return this.values().has(name); }
}

class FakeElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.value = "";
    this.disabled = false;
    this.classList = new FakeClassList(this);
  }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children.slice(); }
  remove() { this.removed = true; }
  click() { if (typeof this.onclick === "function") this.onclick({ preventDefault() {}, stopPropagation() {} }); }
  addEventListener() {}
  removeEventListener() {}
  focus() {}
}

global.document = { createElement: (tag) => new FakeElement(tag) };

function makePlayer(uid = 1, layoutName = "Level 1") {
  const vars = Array(18).fill(0);
  vars[17] = "";
  return {
    uid,
    x: 100,
    y: 200,
    angle: 0,
    cur_frame: 0,
    instance_vars: vars,
    behavior_insts: [{ enabled: true }],
    siblings: [],
    layer: { name: "Game", layoutName },
    set_bbox_changed() {}
  };
}

function makeAdapter(layoutName = "Level 1") {
  const adapter = Object.create(ns.OvO144Adapter.prototype);
  adapter.runtime = {
    running_layout: { name: layoutName, layers: [{ name: "Game" }] },
    layouts: { "Main Menu": {}, "Level 1": {}, "Level 2": {} },
    types_by_index: [],
    destroyed: [],
    DestroyInstance(instance) { this.destroyed.push(instance); },
    createInstance(type, layer, x, y) {
      if (type === adapter.playerType) {
        const player = makePlayer(++this.nextUid, this.running_layout.name);
        player.x = x; player.y = y; player.layer = layer;
        type.instances.push(player);
        return player;
      }
      const label = {
        uid: ++this.nextUid, type, layer, x, y, text: "", visible: true, opacity: 1,
        set_bbox_changed() {}, updateFont() { this.text_changed = true; }
      };
      type.instances.push(label);
      return label;
    },
    nextUid: 100
  };
  adapter.playerType = { instances: [] };
  adapter.textType = { instances: [] };
  adapter.globalType = { instances: [{ instance_vars: Array(24).fill("") }] };
  adapter.ghostArrayType = null;
  adapter.endFlagType = { instances: [] };
  adapter.remoteInstances = new Map();
  adapter.localLabels = null;
  adapter.localPlayerUid = null;
  adapter.multiplayerActive = true;
  adapter.disabledGhostActions = null;
  adapter.runtime.types_by_index = [adapter.playerType, adapter.textType];
  return adapter;
}

test("release and loader are internally consistent", () => {
  assert.equal(ns.CLIENT_VERSION, "0.2.0-alpha.9");
  assert.equal(ns.PROTOCOL_VERSION, 2);
  const loader = source("loader.js");
  for (const file of ["00-namespace.js", "10-snapshot-buffer.js", "20-network.js", "21-directory.js", "30-adapter-1.4.4.js", "31-render-fix.js", "40-ui.js", "41-ui-fixes.js", "42-patch-notes.js", "50-app.js", "99-bootstrap.js"]) {
    assert.equal(loader.split(`"${file}"`).length - 1, 1, `${file} must load exactly once`);
  }
  assert.match(loader, /v=0\.2\.0-alpha\.9/);
  assert.match(loader, /cache: "no-store"/);
  assert.match(source("modloader-code.txt"), /loader\.js\?t="\+Date\.now\(\)/);
});

test("snapshot interpolation, scene reset, teleport reset, and stale expiry", () => {
  const buffer = new ns.SnapshotBuffer({ interpolationDelayMs: 100 });
  buffer.push({ x: 0, y: 0, angle: 0, layout: "Level 1", layer: "Game", pose: [[0, 0, 0, 1, 1, 0, 1]] }, 1000);
  buffer.push({ x: 100, y: 50, angle: Math.PI, layout: "Level 1", layer: "Game", pose: [[10, 10, 1, 2, 2, 1, 1]] }, 1200);
  const sample = buffer.sample(1200);
  assert.equal(sample.x, 50);
  assert.equal(sample.y, 25);
  assert.equal(sample.pose.length, 1);
  assert.equal(buffer.isStale(3699, 2500), false);
  assert.equal(buffer.isStale(3701, 2500), true);
  buffer.push({ x: 101, y: 51, layout: "Level 2", layer: "Game" }, 1300);
  assert.equal(buffer.snapshots.length, 1, "layout change clears old snapshots");
  buffer.push({ x: 1000, y: 1000, layout: "Level 2", layer: "Game" }, 1400);
  assert.equal(buffer.snapshots.length, 1, "large teleport clears old snapshots");
});

test("network sanitizes state, joins players, and completes race results", () => {
  const transport = new ns.PeerRoomTransport({ playerId: "host", username: " Host ", gameVersion: "1.4.4" });
  const clean = transport.sanitizeState({
    active: true, x: 9e9, y: -9e9, layout: "Level 1", layer: "Game", username: "Runner",
    skin: "skin", state: "walk", side: -1, frame: 2, pose: [[2, 3, 0, 4, 5, 1, 1]]
  });
  assert.equal(clean.x, 1000000);
  assert.equal(clean.y, -1000000);
  assert.equal(clean.pose.length, 1);
  assert.equal(transport.sanitizeState({ active: true, x: NaN, y: 1 }), null);

  const sent = [];
  const conn = { open: true, send: (message) => sent.push(message), close() {} };
  const entry = { conn, playerId: null, joinTimer: setTimeout(() => {}, 1000) };
  transport.isHost = true;
  transport.room = { code: "BCDF67", mode: "race", visibility: "public", maxPlayers: 8 };
  transport.players = new Map([["host", transport.selfProfile(true)]]);
  transport.connections = new Map();
  transport.handleHostMessage(entry, { t: "join", protocolVersion: 2, playerId: "peer", username: "Peer", gameVersion: "1.4.4" });
  assert.equal(transport.players.get("peer").username, "Peer");
  assert.equal(sent[0].t, "welcome");

  const broadcasts = [];
  transport.broadcast = (message) => broadcasts.push(message);
  assert.equal(transport.startRace({ layout: "Level 2", countdownMs: 3000 }), true);
  assert.equal(transport.raceSession.layout, "Level 2");
  assert.equal(transport.recordRaceFinish("peer", { raceId: transport.raceSession.raceId, timeMs: 1234 }), true);
  assert.equal(transport.recordRaceFinish("peer", { raceId: transport.raceSession.raceId, timeMs: 999 }), false);
  assert.equal(transport.recordRaceFinish("host", { raceId: transport.raceSession.raceId, timeMs: 1500 }), true);
  assert.deepEqual(transport.raceSession.results.map((result) => result.placement), [1, 2]);
  assert(broadcasts.some((packet) => packet.t === "race_start"));
  assert(broadcasts.some((packet) => packet.t === "race_results"));
});

test("Freeplay host and client create, join, welcome, and leave cleanly", async () => {
  class FakeWire {
    constructor() { this.handlers = new Map(); this.open = true; this.sent = []; }
    on(name, handler) { this.handlers.set(name, handler); }
    emit(name, value) { this.handlers.get(name)?.(value); }
    send(message) { this.sent.push(message); }
    close() { this.open = false; }
  }
  class FakePeer {
    constructor(id) { this.id = id; this.handlers = new Map(); this.connection = new FakeWire(); FakePeer.instances.push(this); }
    on(name, handler) { this.handlers.set(name, handler); }
    emit(name, value) { this.handlers.get(name)?.(value); }
    connect() { return this.connection; }
    destroy() { this.destroyed = true; }
    reconnect() { this.disconnected = false; }
  }
  FakePeer.instances = [];
  global.Peer = FakePeer;

  const host = new ns.PeerRoomTransport({ playerId: "host", username: "Host", gameVersion: "1.4.4" });
  host.ready = true;
  let hosted;
  host.addEventListener("room_joined", (event) => { hosted = event.detail; });
  await host.createRoom({ mode: "freeplay", visibility: "public", maxPlayers: 4 });
  host.peer.emit("open");
  assert.equal(hosted.room.mode, "freeplay");
  assert.equal(hosted.room.visibility, "public");
  assert.equal(hosted.players.length, 1);
  host.leaveRoom();
  assert.equal(host.room, null);

  const client = new ns.PeerRoomTransport({ playerId: "client", username: "Client", gameVersion: "1.4.4" });
  client.ready = true;
  let joined;
  let left = false;
  client.addEventListener("room_joined", (event) => { joined = event.detail; });
  client.addEventListener("room_left", () => { left = true; });
  await client.joinRoom("ABC123");
  client.peer.emit("open");
  const wire = client.hostConnection;
  wire.emit("open");
  assert.equal(wire.sent[0].t, "join");
  assert.equal(wire.sent[0].protocolVersion, 2);
  wire.emit("data", {
    t: "welcome",
    room: { code: "ABC123", ownerId: "host", mode: "freeplay", visibility: "private", maxPlayers: 8 },
    players: [{ playerId: "host", username: "Host" }, { playerId: "client", username: "Client" }]
  });
  assert.equal(joined.room.code, "ABC123");
  assert.equal(joined.players.length, 2);
  client.leaveRoom();
  assert.equal(left, true);
  assert.equal(client.room, null);
  delete global.Peer;
});

test("directory filters friends and publishes only hosted public rooms", () => {
  const directory = new ns.PeerDirectory({ playerId: "self", friendCode: "SELF1234", username: "Self" });
  directory.watching = ["FRIEND77"];
  directory.setPresence({ roomCode: "ABC123", mode: "freeplay", visibility: "private", playerCount: 2 });
  directory.setHostedRoom({ code: "ABC123", mode: "freeplay", visibility: "private", playerCount: 2 });
  assert.equal(directory.hostedRoom, null);
  directory.setHostedRoom({ code: "PUB123", mode: "race", visibility: "public", maxPlayers: 8, playerCount: 3, ownerUsername: "Self", layout: "Level 2" });
  directory.applyHeartbeat(directory.buildHeartbeat());
  directory.applyHeartbeat({
    playerId: "friend-tab", friendCode: "FRIEND77", username: "Friend", watching: [],
    presence: { roomCode: "PRIV77", mode: "freeplay", visibility: "private", playerCount: 2 }, room: null
  });
  directory.applyHeartbeat({
    playerId: "stranger", friendCode: "OTHER999", username: "Other", watching: [],
    presence: { roomCode: "", mode: "freeplay", visibility: "private", playerCount: 1 }, room: null
  });
  const snapshot = directory.buildSnapshot(new Set(["FRIEND77"]));
  assert.equal(snapshot.rooms.length, 1);
  assert.equal(snapshot.rooms[0].code, "PUB123");
  assert.equal(snapshot.presences.length, 1);
  assert.equal(snapshot.presences[0].username, "Friend");
  assert.equal(snapshot.presences[0].roomCode, "PRIV77");
  directory.removePlayer("friend-tab");
  assert.equal(directory.buildSnapshot(new Set(["FRIEND77"])).presences.length, 0);
});

test("adapter excludes menu previews and synchronizes real level players", () => {
  const adapter = makeAdapter("Main Menu");
  const preview = makePlayer(1, "Main Menu");
  adapter.playerType.instances.push(preview);
  assert.equal(adapter.getLocalState("Me").active, false);
  adapter.runtime.running_layout.name = "Level 1";
  assert.equal(adapter.getLocalState("Me").active, true);
  assert.equal(adapter.getLocalState("Me").username, "Me");
  assert.deepEqual(adapter.listRaceLayouts(), ["Level 1", "Level 2"]);
});

test("remote collider recycling cannot delete or hide the respawned local player", () => {
  const adapter = makeAdapter("Level 2");
  const recycled = makePlayer(200, "Level 2");
  recycled.__gmpRemote = true;
  recycled.__gmpRemoteUid = 100;
  const remote = { playerId: "peer", instance: recycled, instanceUid: 100, labels: [] };
  adapter.remoteInstances.set("peer", remote);
  adapter.playerType.instances.push(recycled);

  adapter.destroyRemotePlayer("peer");
  assert(!adapter.runtime.destroyed.includes(recycled), "recycled local collider must survive remote cleanup");
  assert.equal(recycled.__gmpRemote, false);
  assert.equal(adapter.getLocalPlayer(), recycled);
  assert.equal(adapter.getLocalState("Me").active, true);
});

test("a dying remote remains excluded until Construct actually recycles it", () => {
  const adapter = makeAdapter("Level 1");
  const remotePlayer = makePlayer(100, "Level 1");
  remotePlayer.__gmpRemote = true;
  remotePlayer.__gmpRemoteUid = 100;
  const remote = { playerId: "peer", instance: remotePlayer, instanceUid: 100, labels: [] };
  adapter.remoteInstances.set("peer", remote);
  adapter.playerType.instances.push(remotePlayer);
  adapter.destroyRemotePlayer("peer");
  assert(adapter.runtime.destroyed.includes(remotePlayer));
  assert.equal(remotePlayer.__gmpRemote, true, "death-row collider must not become a local candidate");
  assert.equal(adapter.getLocalPlayer(), null);
});

test("remote names, own name, skins, and orphan cleanup are UID safe", () => {
  const adapter = makeAdapter("Level 1");
  const local = makePlayer(1);
  adapter.playerType.instances.push(local);
  adapter.updateLocalPlayerLabel("LocalName");
  assert(adapter.labelsAreLive(adapter.localLabels));
  assert(adapter.localLabels.every((label) => label.text === "LocalName"));

  const nested = { uid: 302, behaviorSkins: [] };
  const helper = { uid: 301, behaviorSkins: [{ object: nested, destroy() { adapter.runtime.DestroyInstance(this.object); this.object = null; } }] };
  const behavior = { object: helper, destroy() { this.object.behaviorSkins[0].destroy(); adapter.runtime.DestroyInstance(this.object); this.object = null; } };
  adapter.destroySkinObjects({ siblings: [{ behaviorSkins: [behavior] }] }, "peer");
  assert(adapter.runtime.destroyed.includes(helper));
  assert(adapter.runtime.destroyed.includes(nested));

  const recycledLabel = { uid: 9, __gmpNameLabelOwner: "peer", __gmpNameLabelUid: 8 };
  adapter.textType.instances.push(recycledLabel);
  adapter.sweepOwnedVisuals("peer");
  assert(!adapter.runtime.destroyed.includes(recycledLabel));
  assert.equal(recycledLabel.__gmpNameLabelOwner, null);
});

test("UI renders Lobby, Race, Browse, Friends, names, and tab state", () => {
  const ui = Object.create(ns.GhostyUI.prototype);
  ui.playerId = "self";
  ui.room = { mode: "race", ownerId: "self" };
  ui.players = new Map([
    ["self", { playerId: "self", username: "OwnName", gameVersion: "1.4.4", isOwner: true }],
    ["peer", { playerId: "peer", username: "JoinedName", connected: false }]
  ]);
  ui.refs = {
    playerCount: new FakeElement(), playerList: new FakeElement(), startRace: new FakeElement(), raceStatus: new FakeElement(),
    raceResults: new FakeElement(), publicRoomList: new FakeElement(), friendList: new FakeElement(), tabs: new FakeElement(), body: new FakeElement()
  };
  ui.renderPlayers();
  assert.equal(ui.refs.playerCount.textContent, "2 players");
  assert.equal(ui.refs.playerList.children[0].children[0].textContent, "OwnName");
  assert.equal(ui.refs.playerList.children[1].children[0].textContent, "JoinedName");
  ui.updateRaceControls();
  assert.equal(ui.refs.startRace.disabled, false);
  ui.setRaceResults([{ username: "Winner", timeMs: 61234 }]);
  assert.equal(ui.refs.raceResults.children[0].children[1].textContent, "1:01.234");

  let emitted;
  ui.emit = (name, detail) => { emitted = { name, detail }; };
  ui.publicRooms = [{ code: "PUB123", ownerUsername: "Host", mode: "race", playerCount: 2, maxPlayers: 8, layout: "Level 2" }];
  ui.renderPublicRooms();
  ui.refs.publicRoomList.children[0].children[1].click();
  assert.deepEqual(emitted, { name: "join_room", detail: { roomCode: "PUB123" } });

  ui.friends = [{ friendCode: "FRIEND77" }];
  ui.presences = [{ friendCode: "FRIEND77", username: "Friend", roomCode: "PRIV77", mode: "freeplay", playerCount: 2 }];
  ui.renderFriends();
  assert.equal(ui.refs.friendList.children[0].children[0].children[0].textContent, "Friend");

  const lobby = new FakeElement();
  const race = new FakeElement();
  ui.activeTab = "lobby";
  ui.refs.lobbyView = lobby;
  ui.refs.raceView = race;
  const lobbyTab = ui.addTab("lobby", "Lobby", lobby);
  const raceTab = ui.addTab("race", "Race", race);
  ui.panel = { querySelectorAll: (selector) => selector === ".gmp-tab" ? [lobbyTab, raceTab] : [lobby, race] };
  ui.showTab("race");
  assert.equal(ui.activeTab, "race");
  assert(raceTab.classList.contains("active"));
  assert(race.classList.contains("active"));
});

test("app clears levels, expires stale peers, resumes fresh peers, and finishes races", () => {
  const app = Object.create(ns.GhostysMultiplayerApp.prototype);
  const calls = [];
  const fresh = { clear() { calls.push("fresh-clear"); }, isStale: () => false, sample: () => ({ active: true, layout: "Level 2", x: 1, y: 2 }) };
  const stale = { clear() { calls.push("stale-clear"); }, isStale: () => true, sample: () => { throw new Error("stale snapshot sampled"); } };
  app.destroyed = false;
  app.lastLayout = "Level 1";
  app.room = { mode: "freeplay" };
  app.username = "Me";
  app.buffers = new Map([["fresh", fresh], ["stale", stale]]);
  app.adapter = {
    currentLayout: () => "Level 2", isPlayableLayout: (name) => /^Level/.test(name), handleLayoutChange: () => calls.push("layout"),
    destroyBuiltInGhosts: () => {}, updateLocalPlayerLabel: () => calls.push("local-label"), updateRemotePlayer: (id) => calls.push(`update-${id}`),
    destroyRemotePlayer: (id) => calls.push(`destroy-${id}`)
  };
  app.updateDirectoryPresence = () => {};
  app.tickRace = () => {};
  app.tick();
  assert(calls.includes("layout"));
  assert(calls.includes("fresh-clear"));
  assert(calls.includes("stale-clear"));
  assert(calls.includes("update-fresh"));
  assert(calls.includes("destroy-stale"));

  const sent = [];
  app.room = { mode: "race" };
  app.race = { raceId: "race", layout: "Level 2", countdownEnd: performance.now() - 1, startTime: 0, finished: false, finishWasOverlapping: false };
  app.adapter = {
    setLocalControlsEnabled: (enabled) => calls.push(`controls-${enabled}`), currentLayout: () => "Level 2", isAtFinish: () => true
  };
  app.socket = { send: (type, payload) => sent.push({ type, payload }) };
  app.ui = { setRaceState: () => {}, toast: () => {}, formatTime: () => "0:01.000" };
  ns.GhostysMultiplayerApp.prototype.tickRace.call(app);
  assert.equal(app.race.finished, true);
  assert.equal(sent[0].type, "finish_race");
});

test("app persists friends and performs joined-room and leave-room cleanup", () => {
  const app = Object.create(ns.GhostysMultiplayerApp.prototype);
  const calls = [];
  app.friendCode = "SELF1234";
  app.friends = [];
  app.presences = [];
  app.buffers = new Map([["old", {}]]);
  app.players = new Map();
  app.playerId = "self";
  app.username = "OwnName";
  app.race = null;
  app.directory = { refresh: () => calls.push("refresh"), setWatching: (codes) => calls.push(`watch-${codes.length}`) };
  app.ui = {
    setFriends: () => calls.push("friends-ui"), toast: (message) => calls.push(message), setRoom: () => calls.push("room-ui"),
    setPlayers: () => calls.push("players-ui"), showTab: () => {}, setRaceState: () => {}, setRaceResults: () => {}
  };
  app.addFriend("friend-77");
  assert.deepEqual(app.friends, [{ friendCode: "FRIEND77" }]);
  assert.match(localStorage.getItem(ns.STORAGE_KEYS.friends), /FRIEND77/);
  app.removeFriend("FRIEND77");
  assert.equal(app.friends.length, 0);

  app.removeRemotePlayer = (id) => { calls.push(`remove-${id}`); app.buffers.delete(id); };
  app.adapter = {
    destroyAllRemotePlayers: () => calls.push("destroy-remotes"), setMultiplayerActive: (active) => calls.push(`active-${active}`),
    updateLocalPlayerLabel: (name) => calls.push(`label-${name}`), setLocalControlsEnabled: () => {}, currentLayout: () => "Level 1"
  };
  app.socket = { isHost: true };
  app.updateDirectoryPresence = () => calls.push("presence");
  app.handleRoomJoined({
    room: { code: "ROOM77", ownerId: "self", mode: "freeplay", visibility: "private" },
    players: [{ playerId: "self", username: "OwnName" }, { playerId: "peer", username: "Peer" }],
    resumed: false
  });
  assert.equal(app.room.code, "ROOM77");
  assert.equal(app.players.size, 2);
  assert(calls.includes("active-true"));
  assert(calls.includes("label-OwnName"));
  app.handleRoomLeft();
  assert.equal(app.room, null);
  assert.equal(app.players.size, 0);
  assert(calls.includes("active-false"));
});

test("Race rejects unavailable levels and initializes valid synchronized starts", () => {
  const app = Object.create(ns.GhostysMultiplayerApp.prototype);
  const sent = [];
  const calls = [];
  app.room = { code: "RACE77", mode: "race" };
  app.socket = { send: (type, payload) => sent.push({ type, payload }) };
  app.adapter = {
    listRaceLayouts: () => ["Level 1", "Level 2"], changeLayout: (layout) => calls.push(`layout-${layout}`)
  };
  app.ui = {
    toast: (message) => calls.push(message), setRoom: () => {}, setRaceResults: () => {}, showTab: () => {}, setOpen: () => {}
  };
  app.updateDirectoryPresence = () => {};
  app.handleRaceStarted({ raceId: "bad", layout: "Level 99", countdownMs: 3000 });
  assert.equal(sent[0].type, "leave_room");
  app.handleRaceStarted({ raceId: "good", layout: "Level 2", countdownMs: 3000, results: [] });
  assert.equal(app.race.raceId, "good");
  assert.equal(app.race.layout, "Level 2");
  assert(calls.includes("layout-Level 2"));
});

test("source guards cover modal teardown, bootstrap teardown, race, browse, and friends", () => {
  const uiFixes = source("41-ui-fixes.js");
  const bootstrap = source("99-bootstrap.js");
  const app = source("50-app.js");
  assert.match(uiFixes, /removeEventListener\("wheel"/);
  assert.match(uiFixes, /documentElement\.style\.overscrollBehavior = ""/);
  assert.match(bootstrap, /previousApp\.runtime\?\.untickMe/);
  assert.match(bootstrap, /cleanOrphanedSkinObjects/);
  assert.match(app, /start_race/);
  assert.match(app, /refresh_rooms/);
  assert.match(app, /add_friend/);
  assert.match(app, /remove_friend/);
  assert.match(source("42-patch-notes.js"), /0\.2\.0-alpha\.9/);
});

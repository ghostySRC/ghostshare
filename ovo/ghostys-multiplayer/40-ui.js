(function (root) {
  "use strict";
  const ns = root.GMPInternal;

  class GhostyUI extends EventTarget {
    constructor(options = {}) {
      super();
      this.username = options.username || "OvO Player";
      this.playerId = options.playerId || "";
      this.room = null;
      this.players = new Map();
      this.publicRooms = [];
      this.friends = [];
      this.presences = [];
      this.activeTab = "lobby";
      this.refs = {};
      this.injectStyles();
      this.build(options.layouts || []);
    }

    injectStyles() {
      document.getElementById("gmp-styles")?.remove();
      const style = document.createElement("style");
      style.id = "gmp-styles";
      style.textContent = `
        #gmp-toggle,#gmp-panel,#gmp-toast,#gmp-race-overlay{font-family:Retron2000,monospace;box-sizing:border-box}
        #gmp-toggle{position:fixed;top:4px;left:52px;width:40px;height:35px;z-index:2147483646;background:white;color:black;border:2px solid black;border-radius:5px;cursor:pointer;font-size:13px;font-weight:700}
        #gmp-toggle[data-state="online"]{box-shadow:inset 0 -5px 0 #35c84a}#gmp-toggle[data-state="reconnecting"]{box-shadow:inset 0 -5px 0 #f5a623}
        #gmp-backdrop{position:fixed;inset:0;z-index:2147483644;background:rgba(0,0,0,.28);backdrop-filter:blur(1.2px);display:none}
        #gmp-panel{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483645;width:min(820px,94vw);max-height:88vh;overflow:hidden;background:white;color:black;border:3px solid black;border-radius:12px;display:none}
        .gmp-header,.gmp-space{display:flex;align-items:center;justify-content:space-between;gap:10px}.gmp-header{padding:14px 18px;border-bottom:3px solid black}.gmp-title{font-size:clamp(22px,3vw,34px)}
        .gmp-close{border:0;background:white;color:#e53935;font-size:30px;cursor:pointer;line-height:1}.gmp-tabs{display:flex;gap:7px;padding:10px 14px;border-bottom:2px solid black;overflow-x:auto}
        .gmp-tab{flex:1;min-width:88px;border:2px solid black;border-radius:8px;background:white;padding:9px;font:inherit;cursor:pointer}.gmp-tab.active{background:#cdefff}
        .gmp-body{padding:18px;overflow:auto;max-height:calc(88vh - 150px)}.gmp-view{display:none}.gmp-view.active{display:block}.gmp-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .gmp-card{border:2px solid black;border-radius:10px;padding:14px;background:white}.gmp-card h2,.gmp-card h3{margin:0 0 10px}.gmp-card h3{font-size:20px}
        .gmp-field{display:flex;flex-direction:column;gap:6px;margin:10px 0}.gmp-input{border:2px solid black;border-radius:8px;padding:10px 12px;font:inherit;background:white;color:black;min-width:0}
        .gmp-button{border:2px solid black;border-radius:9px;padding:10px 12px;font:inherit;background:white;color:black;cursor:pointer}.gmp-button.primary{background:#8f67e8;color:white}.gmp-button.race{background:#ffcb45}.gmp-button.danger{background:#ef5350;color:white}.gmp-button:disabled{opacity:.45;cursor:not-allowed}
        .gmp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.gmp-status-dot{width:10px;height:10px;border-radius:50%;background:#999;display:inline-block;border:1px solid black}.gmp-status-dot.online{background:#35c84a}.gmp-status-dot.reconnecting,.gmp-status-dot.connecting{background:#f5a623}
        .gmp-code{font-size:28px;letter-spacing:4px}.gmp-muted{opacity:.62;font-size:12px}.gmp-player,.gmp-list-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #ddd}.gmp-player:last-child,.gmp-list-row:last-child{border-bottom:0}
        .gmp-badge{border:1px solid black;border-radius:999px;padding:2px 7px;font-size:10px}.gmp-empty{text-align:center;padding:22px 8px;opacity:.6}.gmp-online{color:#198c2e}.gmp-offline{opacity:.55}.gmp-race-clock{text-align:center;font-size:34px;padding:14px}.gmp-result:before{counter-increment:place;content:counter(place) ". ";font-weight:bold}.gmp-race-results{counter-reset:place}
        #gmp-toast{position:fixed;right:18px;top:18px;z-index:2147483647;display:none;background:black;color:white;border:2px solid white;border-radius:8px;padding:10px 14px;max-width:340px}
        #gmp-race-overlay{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:2147483643;display:none;pointer-events:none;color:white;-webkit-text-stroke:3px black;text-shadow:3px 3px 0 black;font-size:clamp(48px,10vw,96px);line-height:1;text-align:center}
        @media(max-width:650px){.gmp-grid{grid-template-columns:1fr}.gmp-wide{grid-column:auto!important}#gmp-panel{width:95vw}.gmp-tab{flex:0 0 auto}}
      `;
      document.head.appendChild(style);
    }

    build(layouts) {
      const toggle = document.createElement("button"); toggle.id = "gmp-toggle"; toggle.textContent = "GMP"; toggle.title = "Ghosty's Multiplayer"; toggle.dataset.state = "offline";
      const backdrop = document.createElement("div"); backdrop.id = "gmp-backdrop";
      const panel = document.createElement("div"); panel.id = "gmp-panel";
      const levelOptions = (layouts.length ? layouts : ["Level 1"]).map((name) => `<option>${name}</option>`).join("");
      panel.innerHTML = `
        <div class="gmp-header"><div class="gmp-title">Ghosty's Multiplayer</div><button class="gmp-close" id="gmp-close">×</button></div><div class="gmp-tabs"></div>
        <div class="gmp-body"><div class="gmp-space gmp-card" style="margin-bottom:12px"><div class="gmp-row"><span id="gmp-status-dot" class="gmp-status-dot"></span><span id="gmp-status-text">Offline</span></div><div id="gmp-ping">-- ms</div></div>
          <div id="gmp-lobby-view" class="gmp-view active"><div id="gmp-disconnected-view" class="gmp-grid">
            <div class="gmp-card"><h3>Profile</h3><label class="gmp-field">Username<input id="gmp-username" class="gmp-input" maxlength="20"></label><button id="gmp-save-name" class="gmp-button">Save username</button></div>
            <div class="gmp-card"><h3>Freeplay</h3><div class="gmp-row" style="margin-bottom:10px"><button id="gmp-create" class="gmp-button primary" style="flex:1">Create private</button><button id="gmp-create-public" class="gmp-button" style="flex:1">Create public</button></div><div class="gmp-row"><input id="gmp-room-code" class="gmp-input" maxlength="6" placeholder="ROOM CODE" style="flex:1;text-transform:uppercase"><button id="gmp-join" class="gmp-button">Join</button></div><div class="gmp-muted" style="margin-top:10px">Public rooms appear in Browse. Private rooms use an invite code.</div></div>
          </div><div id="gmp-connected-view" style="display:none"><div class="gmp-grid"><div class="gmp-card"><h3>Room</h3><div id="gmp-room-display" class="gmp-code">------</div><div class="gmp-row" style="margin-top:12px"><button id="gmp-copy-code" class="gmp-button">Copy code</button><button id="gmp-copy-invite" class="gmp-button">Copy invite</button></div></div><div class="gmp-card"><h3>Session</h3><div id="gmp-room-mode">Freeplay</div><div id="gmp-player-count" style="margin-top:8px">0 players</div><button id="gmp-leave" class="gmp-button danger" style="margin-top:12px">Leave room</button></div><div class="gmp-card gmp-wide" style="grid-column:1/-1"><h3>Players</h3><div id="gmp-player-list"></div></div></div></div></div>
          <div id="gmp-race-view" class="gmp-view"><div class="gmp-grid"><div class="gmp-card"><h3>Create a race</h3><label class="gmp-field">Level<select id="gmp-race-level" class="gmp-input">${levelOptions}</select></label><label class="gmp-field">Visibility<select id="gmp-race-visibility" class="gmp-input"><option value="public">Public</option><option value="private">Private</option></select></label><button id="gmp-create-race" class="gmp-button race" style="width:100%">Create race room</button></div><div class="gmp-card"><h3>Race control</h3><div id="gmp-race-status" class="gmp-muted">Create or join a Race room first.</div><div id="gmp-race-clock" class="gmp-race-clock">READY</div><button id="gmp-start-race" class="gmp-button primary" style="width:100%" disabled>Start race</button></div><div class="gmp-card gmp-wide" style="grid-column:1/-1"><h3>Results</h3><div id="gmp-race-results" class="gmp-race-results"><div class="gmp-empty">No race results yet.</div></div></div></div></div>
          <div id="gmp-browse-view" class="gmp-view"><div class="gmp-space" style="margin-bottom:12px"><div><h2 style="margin:0">Public rooms</h2><div class="gmp-muted">Directory: <span id="gmp-directory-status">Connecting…</span></div></div><button id="gmp-refresh-rooms" class="gmp-button">Refresh</button></div><div id="gmp-public-room-list" class="gmp-card"></div></div>
          <div id="gmp-friends-view" class="gmp-view"><div class="gmp-grid"><div class="gmp-card"><h3>Your friend code</h3><div id="gmp-friend-code" class="gmp-code">--------</div><button id="gmp-copy-friend-code" class="gmp-button" style="margin-top:10px">Copy code</button></div><div class="gmp-card"><h3>Add friend</h3><div class="gmp-row"><input id="gmp-add-friend-code" class="gmp-input" maxlength="10" placeholder="FRIEND CODE" style="flex:1;text-transform:uppercase"><button id="gmp-add-friend" class="gmp-button primary">Add</button></div><div class="gmp-muted" style="margin-top:10px">Friend codes stay saved in this browser.</div></div><div class="gmp-card gmp-wide" style="grid-column:1/-1"><h3>Friends</h3><div id="gmp-friend-list"></div></div></div></div>
        </div>`;
      const toast = document.createElement("div"); toast.id = "gmp-toast";
      const raceOverlay = document.createElement("div"); raceOverlay.id = "gmp-race-overlay";
      document.body.append(toggle, backdrop, panel, toast, raceOverlay); this.root = toggle; this.panel = panel;
      const q = (selector) => panel.querySelector(selector);
      this.refs = { toggle, backdrop, panel, toast, raceOverlay, tabs:q(".gmp-tabs"), body:q(".gmp-body"), statusDot:q("#gmp-status-dot"), statusText:q("#gmp-status-text"), directoryStatus:q("#gmp-directory-status"), ping:q("#gmp-ping"), disconnectedView:q("#gmp-disconnected-view"), connectedView:q("#gmp-connected-view"), username:q("#gmp-username"), roomCode:q("#gmp-room-code"), roomDisplay:q("#gmp-room-display"), roomMode:q("#gmp-room-mode"), playerCount:q("#gmp-player-count"), playerList:q("#gmp-player-list"), publicRoomList:q("#gmp-public-room-list"), friendCode:q("#gmp-friend-code"), friendList:q("#gmp-friend-list"), raceStatus:q("#gmp-race-status"), raceClock:q("#gmp-race-clock"), raceResults:q("#gmp-race-results"), startRace:q("#gmp-start-race") };
      this.refs.username.value = this.username;
      this.addTab("lobby", "Lobby", q("#gmp-lobby-view")); this.addTab("race", "Race", q("#gmp-race-view")); this.addTab("browse", "Browse", q("#gmp-browse-view")); this.addTab("friends", "Friends", q("#gmp-friends-view"));
      toggle.onclick = () => this.setOpen(this.panel.style.display !== "block"); backdrop.onclick = () => this.setOpen(false); q("#gmp-close").onclick = () => this.setOpen(false);
      q("#gmp-save-name").onclick = () => this.emit("save_username", { username:this.refs.username.value.trim() }); q("#gmp-create").onclick = () => this.emit("create_room", { mode:"freeplay", visibility:"private" }); q("#gmp-create-public").onclick = () => this.emit("create_room", { mode:"freeplay", visibility:"public" }); q("#gmp-join").onclick = () => this.emit("join_room", { roomCode:this.refs.roomCode.value.trim().toUpperCase() }); q("#gmp-leave").onclick = () => this.emit("leave_room", {});
      q("#gmp-create-race").onclick = () => this.emit("create_room", { mode:"race", visibility:q("#gmp-race-visibility").value, layout:q("#gmp-race-level").value }); q("#gmp-start-race").onclick = () => this.emit("start_race", { layout:q("#gmp-race-level").value }); q("#gmp-refresh-rooms").onclick = () => this.emit("refresh_rooms", {});
      q("#gmp-add-friend").onclick = () => this.emit("add_friend", { friendCode:q("#gmp-add-friend-code").value }); q("#gmp-copy-friend-code").onclick = () => this.copy(this.refs.friendCode.textContent, "Friend code copied"); q("#gmp-copy-code").onclick = () => this.copy(this.room?.code, "Room code copied"); q("#gmp-copy-invite").onclick = () => { if (!this.room) return; const url = new URL(location.href); url.searchParams.set("gmpRoom", this.room.code); url.searchParams.set("gmpAutoJoin", "1"); this.copy(url.toString(), "Invite link copied"); };
      this.refs.roomCode.addEventListener("keydown", (e) => { if (e.key === "Enter") q("#gmp-join").click(); }); q("#gmp-add-friend-code").addEventListener("keydown", (e) => { if (e.key === "Enter") q("#gmp-add-friend").click(); }); this.renderPublicRooms(); this.renderFriends();
    }

    addTab(name, label, view) { const button = document.createElement("button"); button.className = `gmp-tab${name === this.activeTab ? " active" : ""}`; button.dataset.tab = name; button.textContent = label; button.onclick = () => this.showTab(name); this.refs.tabs.appendChild(button); view.dataset.view = name; this.refs[`${name}Tab`] = button; this.refs[`${name}View`] = view; return button; }
    showTab(name) { if (!this.refs[`${name}View`]) return; this.activeTab = name; this.panel.querySelectorAll(".gmp-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === name)); this.panel.querySelectorAll(".gmp-view").forEach((view) => view.classList.toggle("active", view.dataset.view === name)); this.refs.body.scrollTop = 0; if (name === "browse") this.emit("refresh_rooms", {}); }
    setOpen(open) { this.panel.style.display = open ? "block" : "none"; this.refs.backdrop.style.display = open ? "block" : "none"; }
    setConnectionState(state) { this.root.dataset.state = state; this.refs.statusDot.className = `gmp-status-dot ${state}`; this.refs.statusText.textContent = ({ offline:"Offline",connecting:"Connecting…",reconnecting:"Reconnecting…",online:"Online" })[state] || state; }
    setDirectoryState(state) { if(this.refs.directoryStatus)this.refs.directoryStatus.textContent=({offline:"Offline",connecting:"Connecting…",reconnecting:"Reconnecting…",online:"Online"})[state]||state; }
    setPing(ms) { this.refs.ping.textContent = Number.isFinite(ms) ? `${ms} ms` : "-- ms"; }
    setRoom(room) { this.room = room || null; this.refs.disconnectedView.style.display = room ? "none" : "grid"; this.refs.connectedView.style.display = room ? "block" : "none"; if (room) { this.refs.roomDisplay.textContent = room.code || "------"; this.refs.roomMode.textContent = `${room.mode === "race" ? "Race" : "Freeplay"} · ${room.visibility === "public" ? "Public" : "Private"}`; } this.updateRaceControls(); this.renderPlayers(); }
    setPlayers(players) { this.players = new Map((players || []).map((p) => [p.playerId,p])); this.renderPlayers(); this.updateRaceControls(); }
    upsertPlayer(player) { if (!player?.playerId) return; this.players.set(player.playerId, { ...(this.players.get(player.playerId) || {}), ...player }); this.renderPlayers(); this.updateRaceControls(); }
    removePlayer(id) { this.players.delete(id); this.renderPlayers(); this.updateRaceControls(); }
    renderPlayers() { const players = Array.from(this.players.values()); this.refs.playerCount.textContent = `${players.length} player${players.length === 1 ? "" : "s"}`; this.refs.playerList.replaceChildren(); if (!players.length) return this.refs.playerList.append(this.empty("No players yet.")); for (const player of players) { const row=document.createElement("div"); row.className="gmp-player"; const name=document.createElement("div"); name.textContent=player.username||"Player"; const meta=document.createElement("div"); meta.className="gmp-row"; if(player.isOwner){const badge=document.createElement("span");badge.className="gmp-badge";badge.textContent="OWNER";meta.append(badge)} const status=document.createElement("span");status.className="gmp-muted";status.textContent=player.connected===false?"reconnecting":(player.gameVersion||"");meta.append(status);row.append(name,meta);this.refs.playerList.append(row); } }
    updateRaceControls() { const race=this.room?.mode==="race"; const owner=race&&this.room.ownerId===this.playerId; this.refs.startRace.disabled=!owner; this.refs.raceStatus.textContent=race?(owner?"You are the host. Pick a level and start when everyone is ready.":"Waiting for the host to start the race."):"Create or join a Race room first."; }
    setRaceState(state={}) { const label=state.label||"READY";this.refs.raceClock.textContent=label;if(state.message)this.refs.raceStatus.textContent=state.message;clearTimeout(this.raceOverlayTimer);if(label==="READY"){this.refs.raceOverlay.style.display="none";return}this.refs.raceOverlay.textContent=label;this.refs.raceOverlay.style.display="block";if(label==="GO!"||label.includes(":")){this.raceOverlayTimer=setTimeout(()=>{this.refs.raceOverlay.style.display="none"},label==="GO!"?900:2200)} }
    setRaceResults(results) { this.refs.raceResults.replaceChildren(); if(!results?.length)return this.refs.raceResults.append(this.empty("No race results yet.")); for(const result of results){const row=document.createElement("div");row.className="gmp-list-row gmp-result";const name=document.createElement("span");name.textContent=result.username||"Player";const time=document.createElement("span");time.textContent=this.formatTime(result.timeMs);row.append(name,time);this.refs.raceResults.append(row)} }
    setPublicRooms(rooms) { this.publicRooms=Array.isArray(rooms)?rooms:[]; this.renderPublicRooms(); }
    renderPublicRooms() { const box=this.refs.publicRoomList;box.replaceChildren();if(!this.publicRooms.length)return box.append(this.empty("No public rooms found. Create one from Race, or refresh in a moment."));for(const room of this.publicRooms){const row=document.createElement("div");row.className="gmp-list-row";const info=document.createElement("div");const title=document.createElement("div");title.textContent=`${room.ownerUsername||"Player"}'s ${room.mode==="race"?"Race":"Freeplay"}`;const meta=document.createElement("div");meta.className="gmp-muted";meta.textContent=`${room.code} · ${room.playerCount||1}/${room.maxPlayers||8}${room.layout?` · ${room.layout}`:""}`;info.append(title,meta);const join=document.createElement("button");join.className="gmp-button primary";join.textContent="Join";join.disabled=Number(room.playerCount)>=Number(room.maxPlayers);join.onclick=()=>this.emit("join_room",{roomCode:room.code});row.append(info,join);box.append(row)} }
    setFriendCode(code) { this.refs.friendCode.textContent=code||"--------"; }
    setFriends(friends,presences) { this.friends=Array.isArray(friends)?friends:[];this.presences=Array.isArray(presences)?presences:[];this.renderFriends(); }
    renderFriends() { const box=this.refs.friendList;box.replaceChildren();if(!this.friends.length)return box.append(this.empty("No friends added yet."));const online=new Map(this.presences.map((p)=>[p.friendCode,p]));for(const friend of this.friends){const presence=online.get(friend.friendCode);const row=document.createElement("div");row.className="gmp-list-row";const info=document.createElement("div");const name=document.createElement("div");name.textContent=presence?.username||friend.name||friend.friendCode;name.className=presence?"gmp-online":"gmp-offline";const meta=document.createElement("div");meta.className="gmp-muted";meta.textContent=presence?(presence.roomCode?`Online · ${presence.mode} · ${presence.playerCount} player(s)`:"Online"):`Offline · ${friend.friendCode}`;info.append(name,meta);const actions=document.createElement("div");actions.className="gmp-row";if(presence?.roomCode){const join=document.createElement("button");join.className="gmp-button primary";join.textContent="Join";join.onclick=()=>this.emit("join_room",{roomCode:presence.roomCode});actions.append(join)}const remove=document.createElement("button");remove.className="gmp-button";remove.textContent="Remove";remove.onclick=()=>this.emit("remove_friend",{friendCode:friend.friendCode});actions.append(remove);row.append(info,actions);box.append(row)} }
    setUsername(username) { this.username=username;this.refs.username.value=username; }
    toast(message) { if(!message)return;this.refs.toast.textContent=message;this.refs.toast.style.display="block";clearTimeout(this.toastTimer);this.toastTimer=setTimeout(()=>{this.refs.toast.style.display="none"},3000); }
    copy(value,message) { if(!value)return;navigator.clipboard?.writeText(value).then(()=>this.toast(message)).catch(()=>this.toast(value)); }
    empty(text) { const el=document.createElement("div");el.className="gmp-empty";el.textContent=text;return el; }
    formatTime(ms) { const value=Math.max(0,Number(ms)||0);const minutes=Math.floor(value/60000);const seconds=Math.floor(value/1000)%60;const millis=Math.floor(value%1000);return `${minutes}:${String(seconds).padStart(2,"0")}.${String(millis).padStart(3,"0")}`; }
    emit(name,detail) { this.dispatchEvent(new CustomEvent(name,{detail})); }
    destroy() { clearTimeout(this.raceOverlayTimer);this.root?.remove();this.panel?.remove();this.refs.backdrop?.remove();this.refs.toast?.remove();this.refs.raceOverlay?.remove(); }
  }
  Object.assign(ns,{GhostyUI});
})(globalThis);

(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  const BaseUI = ns.GhostyUI;
  if (!BaseUI || BaseUI.__gmpFixedUi) return;

  const oldStyle = document.getElementById("gmp-ui-fixes");
  if (oldStyle) oldStyle.remove();
  const style = document.createElement("style");
  style.id = "gmp-ui-fixes";
  style.textContent = `
    #gmp-toggle{left:auto!important;right:8px!important;top:6px!important;width:44px!important;height:36px!important;z-index:2147483646!important}
    #gmp-backdrop{z-index:2147483647!important;pointer-events:auto!important;background:rgba(0,0,0,.34)!important;touch-action:none!important}
    #gmp-panel{z-index:2147483647!important;height:min(650px,88vh)!important;max-height:88vh!important;display:none;flex-direction:column!important;overflow:hidden!important;overscroll-behavior:contain!important}
    #gmp-panel .gmp-header,#gmp-panel .gmp-tabs{flex:0 0 auto!important}
    #gmp-panel .gmp-body{flex:1 1 auto!important;min-height:0!important;max-height:none!important;overflow-x:hidden!important;overflow-y:scroll!important;overscroll-behavior:contain!important;scrollbar-gutter:stable!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important}
    #gmp-panel input,#gmp-panel button{pointer-events:auto!important}
    @media(max-width:650px){#gmp-panel{height:90vh!important}}
  `;
  document.head.appendChild(style);

  class FixedGhostyUI extends BaseUI {
    constructor(...args) {
      super(...args);
      this.__gmpOpen = false;
      this.__gmpBlockedEvents = ["pointerdown","pointerup","mousedown","mouseup","click","dblclick","contextmenu","touchstart","touchend"];
      this.__gmpOutsideGuard = (event) => {
        if (!this.__gmpOpen || this.panel.contains(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      for (const type of this.__gmpBlockedEvents) document.addEventListener(type, this.__gmpOutsideGuard, true);

      // Let controls work normally, but stop OvO's document/game handlers from
      // receiving clicks and pointer events that belong to this modal.
      this.__gmpPanelGuard = (event) => event.stopPropagation();
      for (const type of this.__gmpBlockedEvents) this.panel.addEventListener(type, this.__gmpPanelGuard);

      this.refs.toggle.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setOpen(!this.__gmpOpen);
      };
      this.refs.backdrop.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      const body = this.panel.querySelector(".gmp-body");
      this.__gmpWheelGuard = (event) => {
        if (!this.__gmpOpen || !this.panel.contains(event.target)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        body.scrollTop += event.deltaY;
      };
      document.addEventListener("wheel", this.__gmpWheelGuard, { passive:false, capture:true });

      this.__gmpKeyDown = (event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          this.setOpen(false);
        }
      };
      this.__gmpKeyUp = (event) => event.stopPropagation();
      this.panel.addEventListener("keydown", this.__gmpKeyDown);
      this.panel.addEventListener("keyup", this.__gmpKeyUp);

      // OvO has global mouse/keyboard handlers. Explicitly keep focus on GMP text
      // inputs so typing a username or room code cannot get stolen by the game.
      for (const input of this.panel.querySelectorAll("input")) {
        input.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          setTimeout(() => input.focus({ preventScroll:true }), 0);
        });
        input.addEventListener("mousedown", (event) => event.stopPropagation());
        input.addEventListener("click", (event) => {
          event.stopPropagation();
          input.focus({ preventScroll:true });
        });
        input.addEventListener("keydown", (event) => event.stopPropagation());
        input.addEventListener("keyup", (event) => event.stopPropagation());
      }

      // Rebind username saving explicitly after the modal guards are installed.
      const saveName = this.panel.querySelector("#gmp-save-name");
      saveName.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.emit("save_username", { username: this.refs.username.value.trim() });
      };
      this.refs.username.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          saveName.click();
        }
      });
    }

    setOpen(open) {
      this.__gmpOpen = !!open;
      this.panel.style.display = this.__gmpOpen ? "flex" : "none";
      this.refs.backdrop.style.display = this.__gmpOpen ? "block" : "none";
      document.documentElement.style.overscrollBehavior = this.__gmpOpen ? "none" : "";
      if (this.__gmpOpen) {
        const body = this.panel.querySelector(".gmp-body");
        body.scrollTop = 0;
        requestAnimationFrame(() => this.panel.querySelector("#gmp-close")?.focus({preventScroll:true}));
      }
    }

    destroy() {
      for (const type of this.__gmpBlockedEvents || []) {
        document.removeEventListener(type, this.__gmpOutsideGuard, true);
        this.panel?.removeEventListener(type, this.__gmpPanelGuard);
      }
      if (this.__gmpWheelGuard) document.removeEventListener("wheel", this.__gmpWheelGuard, true);
      if (this.panel) {
        this.panel.removeEventListener("keydown", this.__gmpKeyDown);
        this.panel.removeEventListener("keyup", this.__gmpKeyUp);
      }
      document.documentElement.style.overscrollBehavior = "";
      super.destroy();
    }
  }

  FixedGhostyUI.__gmpFixedUi = true;
  ns.GhostyUI = FixedGhostyUI;
})(globalThis);

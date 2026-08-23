(function (root) {
  "use strict";
  const ns = root.GMPInternal;
  const BaseUI = ns.GhostyUI;
  if (!BaseUI || BaseUI.__gmpFixedUi) return;

  const style = document.createElement("style");
  style.id = "gmp-ui-fixes";
  style.textContent = `
    #gmp-toggle{left:auto!important;right:8px!important;top:6px!important;width:44px!important;height:36px!important;z-index:2147483646!important}
    #gmp-backdrop{z-index:2147483647!important;pointer-events:auto!important;background:rgba(0,0,0,.34)!important;touch-action:none!important}
    #gmp-panel{z-index:2147483647!important;height:min(650px,88vh)!important;max-height:88vh!important;display:none;flex-direction:column!important;overflow:hidden!important;overscroll-behavior:contain!important}
    #gmp-panel .gmp-header,#gmp-panel .gmp-tabs{flex:0 0 auto!important}
    #gmp-panel .gmp-body{flex:1 1 auto!important;min-height:0!important;max-height:none!important;overflow-x:hidden!important;overflow-y:scroll!important;overscroll-behavior:contain!important;scrollbar-gutter:stable!important;-webkit-overflow-scrolling:touch!important;touch-action:pan-y!important}
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

      this.refs.toggle.onclick = () => this.setOpen(!this.__gmpOpen);
      this.refs.backdrop.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      const body = this.panel.querySelector(".gmp-body");
      this.__gmpWheel = (event) => {
        event.preventDefault();
        event.stopPropagation();
        body.scrollTop += event.deltaY;
      };
      body.addEventListener("wheel", this.__gmpWheel, { passive:false });

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
      for (const type of this.__gmpBlockedEvents || []) document.removeEventListener(type, this.__gmpOutsideGuard, true);
      const body = this.panel?.querySelector(".gmp-body");
      if (body && this.__gmpWheel) body.removeEventListener("wheel", this.__gmpWheel);
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

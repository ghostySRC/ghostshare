(() => {
  "use strict";
  if (globalThis.__ghostysMultiplayerLoaderRunning) return;
  globalThis.__ghostysMultiplayerLoaderRunning = true;

  const base = "https://raw.githubusercontent.com/ghostySRC/ghostshare/main/ovo/ghostys-multiplayer/";
  const files = [
    "00-namespace.js",
    "10-snapshot-buffer.js",
    "20-network.js",
    "30-adapter-1.4.4.js",
    "31-render-fix.js",
    "40-ui.js",
    "41-ui-fixes.js",
    "42-patch-notes.js",
    "50-app.js",
    "99-bootstrap.js"
  ];

  const load = async (file) => {
    const response = await fetch(`${base}${file}?v=0.1.0-alpha.7&t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to fetch ${file} (${response.status})`);
    const code = await response.text();
    const id = `gmp-module-${file}`;
    document.getElementById(id)?.remove();
    const script = document.createElement("script");
    script.id = id;
    script.textContent = `${code}\n//# sourceURL=ghostys-multiplayer/${file}`;
    document.head.appendChild(script);
  };

  (async () => {
    try {
      for (const file of files) await load(file);
    } catch (error) {
      globalThis.__ghostysMultiplayerLoaderRunning = false;
      console.error("[GMP] Loader failed", error);
      alert(`Ghosty's Multiplayer failed to load: ${error.message}`);
    }
  })();
})();

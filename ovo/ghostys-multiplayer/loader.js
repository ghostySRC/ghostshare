(() => {
  "use strict";
  if (globalThis.__ghostysMultiplayerLoaderRunning) return;
  globalThis.__ghostysMultiplayerLoaderRunning = true;

  const base = "https://cdn.jsdelivr.net/gh/ghostySRC/ghostshare@main/ovo/ghostys-multiplayer/";
  const files = [
    "00-namespace.js",
    "10-snapshot-buffer.js",
    "20-network.js",
    "30-adapter-1.4.4.js",
    "40-ui.js",
    "50-app.js",
    "99-bootstrap.js"
  ];

  const load = (file) => new Promise((resolve, reject) => {
    const id = `gmp-module-${file}`;
    const old = document.getElementById(id);
    if (old) old.remove();
    const script = document.createElement("script");
    script.id = id;
    script.src = `${base}${file}?v=0.1.0-alpha.2`;
    script.async = false;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${file}`));
    document.head.appendChild(script);
  });

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

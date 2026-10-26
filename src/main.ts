// fonts are bundled locally so the desktop app works fully offline
import '@fontsource/vt323/400.css';
import '@fontsource/press-start-2p/400.css';
import './style.css';
import { isApp } from './ui/native';
import { boot } from './ui/app';

if (isApp) boot();
else {
  // opened outside the desktop shell (e.g. in a browser): there is no web version
  document.getElementById('app')!.innerHTML = `<div class="gate"><h1>UNISIM</h1><p>UniSim is a desktop application.</p><p class="dim">Start it with <kbd>npm run app</kbd>, or run the built <kbd>unisim.exe</kbd>.</p></div>`;
}

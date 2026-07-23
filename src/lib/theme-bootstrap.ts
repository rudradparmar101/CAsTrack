/**
 * The inline theme-bootstrap script, as a single exported string.
 *
 * It lives here — rather than inline in layout.tsx where it used to be —
 * because next.config.ts needs the EXACT same bytes to compute the CSP
 * script-src hash for it (app-layer security audit, finding M7). Both files
 * import this constant, so the hash in the Content-Security-Policy header and
 * the script the browser actually receives cannot drift apart. If they ever
 * did, the browser would silently refuse to run the script and every hard
 * navigation would flash light-then-dark again — a failure that is easy to
 * miss and annoying to diagnose, which is exactly why it is structurally
 * prevented instead of documented.
 *
 * This module must stay import-free and side-effect-free: it is evaluated in
 * the Next config context as well as the app runtime.
 *
 * What the script does: reads the persisted theme (falling back to the OS
 * preference) and sets the `dark` class before first paint. Without it, SSR
 * always ships the light class and ThemeProvider's effect corrects it only
 * after hydration, producing a visible flash on any hard navigation — e.g.
 * landing on /login after sign-out. Client-side navigation within an
 * already-hydrated app never shows it, which is why this is easy to overlook.
 */
export const THEME_BOOTSTRAP_SCRIPT =
  `(function(){try{var t=localStorage.getItem('dt-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}if(t==='dark'){document.documentElement.classList.add('dark');}}catch(e){}})();`;

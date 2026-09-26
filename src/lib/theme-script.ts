/**
 * Sets `data-theme` on <html> from the saved preference before the first paint, so a light
 * page never flashes dark while it loads. Inlined into the root layout's <head>; it has to
 * read the stored value exactly the way `read` in `prefs.ts` does.
 */
export const THEME_SCRIPT = `(function(){try{var t="dark";try{t=JSON.parse(localStorage.getItem("topset:theme"))||"dark"}catch(e){}if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t==="light"?"light":"dark"}catch(e){}})()`;

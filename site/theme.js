// Light/dark theme. Loaded in <head> without defer so the theme is set before
// the page paints (no flash). Follows the system setting until the visitor picks
// one with the toggle; that choice is remembered in localStorage.
(() => {
  const KEY = "theme";
  const COLORS = { light: "#fafafa", dark: "#09090b" };
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");

  // Storage can throw (private mode, blocked site data); the theme still works for this visit.
  const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (t) => { try { localStorage.setItem(KEY, t); } catch {} };

  function apply(theme) {
    root.dataset.theme = theme;
    for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = COLORS[theme];
    const b = document.getElementById("theme");
    const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
    if (b) { b.setAttribute("aria-label", label); b.title = label; }
  }

  const pick = saved();
  apply(pick === "light" || pick === "dark" ? pick : system.matches ? "dark" : "light");
  // Keep following the system until the visitor chooses.
  system.addEventListener("change", (e) => { if (!saved()) apply(e.matches ? "dark" : "light"); });

  document.addEventListener("DOMContentLoaded", () => {
    apply(root.dataset.theme); // the toggle didn't exist yet on the first apply
    document.getElementById("theme")?.addEventListener("click", () => {
      const next = root.dataset.theme === "dark" ? "light" : "dark";
      save(next);
      apply(next);
    });
  });
})();

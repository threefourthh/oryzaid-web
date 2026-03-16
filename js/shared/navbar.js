export function initNavbar({
  navbarSelector = "#navbar",
  toggleSelector = ".nav-toggle",
  linksSelector = "#nav-links",
  stuckClass = "stuck",
  threshold = 20
} = {}) {
  const navbar = document.querySelector(navbarSelector);
  const btn = document.querySelector(toggleSelector);
  const links = document.querySelector(linksSelector);

  // ======================
  // Sticky navbar (.stuck)
  // ======================
  function onScroll() {
    if (!navbar) return;
    if (window.scrollY > threshold) navbar.classList.add(stuckClass);
    else navbar.classList.remove(stuckClass);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll(); // run once on load

  // ======================
  // Mobile menu toggle
  // ======================
  if (!btn || !links) return;

  btn.addEventListener("click", () => {
    const isOpen = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!isOpen));
    links.classList.toggle("open");
  });

  // Close menu after clicking a link
  links.addEventListener("click", (e) => {
    const a = e.target.closest("a");
    if (!a) return;
    btn.setAttribute("aria-expanded", "false");
    links.classList.remove("open");
  });
}
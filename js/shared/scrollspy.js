export function initScrollSpy({
  navLinkSelector = ".nav-link",
  sectionSelector = "section",
  offset = 150,          // same idea as your old code
  activeClass = "active"
} = {}) {
  const links = Array.from(document.querySelectorAll(navLinkSelector));
  const sections = Array.from(document.querySelectorAll(sectionSelector));

  if (!links.length || !sections.length) return;

  function setActive(id) {
    links.forEach((a) => a.classList.remove(activeClass));
    if (!id) return;

    const match = links.find((a) => a.getAttribute("href") === `#${id}`);
    if (match) match.classList.add(activeClass);
  }

  function onScroll() {
    const y = window.scrollY;
    let current = "";

    for (const section of sections) {
      const top = section.offsetTop;
      const height = section.offsetHeight;

      if (y >= top - offset && y < top + height - offset) {
        current = section.id;
        break;
      }
    }

    setActive(current);
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}
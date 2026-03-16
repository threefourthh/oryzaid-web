import { initNavbar } from "../shared/navbar.js";
import { initScrollSpy } from "../shared/scrollspy.js";

initNavbar({
  toggleSelector: ".nav-toggle",
  linksSelector: "#nav-links",
});

initScrollSpy({
  navLinkSelector: ".nav-link",
  offset: 120, // adjust if your navbar height is different
});
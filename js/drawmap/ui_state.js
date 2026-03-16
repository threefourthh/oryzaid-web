export function showFlightUI() {
  document.querySelector(".flightbars")?.classList.add("show");
  document.getElementById("toolsBar")?.classList.add("hide");
}

export function showDrawUI() {
  document.querySelector(".flightbars")?.classList.remove("show");
  document.getElementById("toolsBar")?.classList.remove("hide");
}
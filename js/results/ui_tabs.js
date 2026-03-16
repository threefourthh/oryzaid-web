// js/results/ui_tabs.js
export function initResultsTabs() {
  const dis = document.getElementById("disresult");
  const pest = document.getElementById("pestresult");

  const btns = Array.from(document.querySelectorAll(".resulttools .result"));

  function show(which) {
    if (dis) dis.style.display = which === "diseases" ? "flex" : "none";
    if (pest) pest.style.display = which === "pests" ? "flex" : "none";
  }

  btns.forEach((b) => {
    b.addEventListener("click", () => {
      btns.forEach((x) => x.classList.remove("ractive"));
      b.classList.add("ractive");

      if (b.id === "print") {
        window.print();
        return;
      }
      show(b.id);
    });
  });

  document.getElementById("printBtn")?.addEventListener("click", () => window.print());

  // default visible
  show("diseases");
}
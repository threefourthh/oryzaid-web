// js/drawmap/center_notif.js

/* =========================
   Simple Center NOTIF (OK only)
========================= */

export function showCenterNotif(message, opts = {}) {
  const overlay = document.getElementById("centerNotif");
  const textEl = document.getElementById("centerNotifText");
  const okBtn = document.getElementById("centerNotifOk");

  // fallback if page does not have the static notif HTML
  if (!overlay || !textEl || !okBtn) {
    alert(message);
    return;
  }

  const { showOk = true, okText = "OK", onOk = null } = opts;

  textEl.textContent = message || "";
  okBtn.textContent = okText;
  okBtn.style.display = showOk ? "inline-flex" : "none";

  okBtn.onclick = null;
  okBtn.onclick =
    typeof onOk === "function"
      ? () => {
          hideCenterNotif();
          onOk();
        }
      : hideCenterNotif;

  overlay.classList.add("show");
}

export function hideCenterNotif() {
  document.getElementById("centerNotif")?.classList.remove("show");
}

export function initCenterNotif() {
  document
    .getElementById("centerNotifOk")
    ?.addEventListener("click", hideCenterNotif);
}

/* =========================
   Shared helpers
========================= */

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function ensureModalStyles() {
  if (document.getElementById("meCenterModalStyles")) return;

  const st = document.createElement("style");
  st.id = "meCenterModalStyles";
  st.textContent = `
    .me-center-root{
      position:fixed;
      inset:0;
      display:none;
      align-items:center;
      justify-content:center;
      z-index:99999;
      padding:20px;
      box-sizing:border-box;
    }

    .me-center-root.show{
      display:flex;
    }

    .me-center-backdrop{
      position:absolute;
      inset:0;
      background:rgba(0,0,0,.45);
      backdrop-filter:blur(2px);
    }

    .me-center-modal{
      position:relative;
      width:min(520px, calc(100vw - 40px));
      background:linear-gradient(180deg, #071311 0%, #0b1d18 100%);
      color:#ffffff;
      border-radius:20px;
      box-shadow:0 20px 50px rgba(0,0,0,.35);
      padding:22px 20px 18px;
      display:flex;
      flex-direction:column;
      gap:14px;
      box-sizing:border-box;
    }

    .me-center-title{
      margin:0;
      font-size:26px;
      font-weight:800;
      line-height:1.15;
      color:#ffffff;
    }

    .me-center-message{
      margin:0;
      font-size:16px;
      line-height:1.5;
      color:rgba(255,255,255,.92);
      word-break:break-word;
    }

    .me-center-input{
      width:100%;
      height:48px;
      border-radius:14px;
      border:1.5px solid rgba(255,255,255,.18);
      background:rgba(255,255,255,.08);
      color:#ffffff;
      padding:0 14px;
      font-size:15px;
      outline:none;
      box-sizing:border-box;
    }

    .me-center-input::placeholder{
      color:rgba(255,255,255,.45);
    }

    .me-center-input:focus{
      border-color:#69d2ef;
      box-shadow:0 0 0 3px rgba(105,210,239,.14);
    }

    .me-center-actions{
      display:flex;
      justify-content:flex-end;
      align-items:center;
      gap:10px;
      flex-wrap:wrap;
      margin-top:2px;
    }

    .me-center-btn{
      min-width:96px;
      height:42px;
      border:none;
      border-radius:999px;
      font-weight:700;
      font-size:14px;
      cursor:pointer;
      padding:0 18px;
    }

    .me-center-btn.cancel{
      background:rgba(255,255,255,.10);
      color:#ffffff;
      border:1px solid rgba(255,255,255,.18);
    }

    .me-center-btn.ok{
      background:#F6CF3A;
      color:#17210f;
    }

    .me-center-btn.ok.danger{
      background:#e81123;
      color:#ffffff;
    }

    .me-center-btn:active{
      transform:scale(.99);
    }

    @media (max-width: 560px){
      .me-center-modal{
        width:min(94vw, 420px);
        padding:20px 16px 16px;
      }

      .me-center-title{
        font-size:23px;
      }

      .me-center-message{
        font-size:15px;
      }

      .me-center-actions{
        flex-direction:column;
        align-items:stretch;
      }

      .me-center-btn{
        width:100%;
      }
    }
  `;
  document.head.appendChild(st);
}

function createRoot(id) {
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
    root.className = "me-center-root";
    document.body.appendChild(root);
  }
  return root;
}

/* =========================
   Center CONFIRM (OK + Cancel)
========================= */

export function showCenterConfirm(message, opts = {}) {
  const {
    title = "MaizeEye",
    okText = "OK",
    cancelText = "Cancel",
    danger = false,
    onOk = null,
    onCancel = null,
  } = opts;

  ensureModalStyles();

  const root = createRoot("centerConfirmRoot");

  root.innerHTML = `
    <div class="me-center-backdrop"></div>
    <div class="me-center-modal" role="dialog" aria-modal="true" aria-labelledby="meConfirmTitle">
      <h3 id="meConfirmTitle" class="me-center-title">${escapeHtml(title)}</h3>
      <p class="me-center-message">${escapeHtml(message)}</p>
      <div class="me-center-actions">
        <button class="me-center-btn cancel" type="button">${escapeHtml(cancelText)}</button>
        <button class="me-center-btn ok ${danger ? "danger" : ""}" type="button">${escapeHtml(okText)}</button>
      </div>
    </div>
  `;

  const btnCancel = root.querySelector(".me-center-btn.cancel");
  const btnOk = root.querySelector(".me-center-btn.ok");
  const backdrop = root.querySelector(".me-center-backdrop");

  const close = () => {
    root.classList.remove("show");
    root.innerHTML = "";
    document.removeEventListener("keydown", onKeyDown);
  };

  const handleCancel = () => {
    close();
    onCancel?.();
  };

  const handleOk = () => {
    close();
    onOk?.();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") handleCancel();
    if (e.key === "Enter") handleOk();
  };

  btnCancel?.addEventListener("click", handleCancel);
  btnOk?.addEventListener("click", handleOk);
  backdrop?.addEventListener("click", handleCancel);

  document.addEventListener("keydown", onKeyDown);

  root.classList.add("show");
  setTimeout(() => btnOk?.focus(), 10);
}

/* =========================
   Prompt modal with input
========================= */

export function showCenterPrompt(message, opts = {}) {
  const {
    title = "MaizeEye",
    placeholder = "Type here...",
    defaultValue = "",
    okText = "OK",
    cancelText = "Cancel",
    danger = false,
    onOk = null,
    onCancel = null,
  } = opts;

  ensureModalStyles();

  const root = createRoot("centerPromptRoot");

  root.innerHTML = `
    <div class="me-center-backdrop"></div>
    <div class="me-center-modal" role="dialog" aria-modal="true" aria-labelledby="mePromptTitle">
      <h3 id="mePromptTitle" class="me-center-title">${escapeHtml(title)}</h3>
      <p class="me-center-message">${escapeHtml(message)}</p>
      <input
        id="mePromptInput"
        class="me-center-input"
        type="text"
        placeholder="${escapeHtml(placeholder)}"
        value="${escapeHtml(defaultValue)}"
        autocomplete="off"
      />
      <div class="me-center-actions">
        <button class="me-center-btn cancel" type="button">${escapeHtml(cancelText)}</button>
        <button class="me-center-btn ok ${danger ? "danger" : ""}" type="button">${escapeHtml(okText)}</button>
      </div>
    </div>
  `;

  const input = root.querySelector("#mePromptInput");
  const btnCancel = root.querySelector(".me-center-btn.cancel");
  const btnOk = root.querySelector(".me-center-btn.ok");
  const backdrop = root.querySelector(".me-center-backdrop");

  const close = () => {
    root.classList.remove("show");
    root.innerHTML = "";
    document.removeEventListener("keydown", onKeyDown);
  };

  const handleCancel = () => {
    close();
    onCancel?.();
  };

  const handleOk = () => {
    const val = String(input?.value || "").trim();
    close();
    onOk?.(val);
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") handleCancel();
    if (e.key === "Enter") {
      e.preventDefault();
      handleOk();
    }
  };

  btnCancel?.addEventListener("click", handleCancel);
  btnOk?.addEventListener("click", handleOk);
  backdrop?.addEventListener("click", handleCancel);

  document.addEventListener("keydown", onKeyDown);

  root.classList.add("show");
  setTimeout(() => {
    input?.focus();
    input?.select?.();
  }, 10);
}
/* A light password gate while the site is unfinished. It stops people from wandering in;
   it is not security, since this code and the data files are public. The password is asked
   once per browser tab session, and the app and its data load only after it.

   To change the password, set HASH to the SHA-256 of SALT followed by the new password.
   To open the site to everyone, delete this file, its <script> tag in index.html,
   the robots meta tag there and the .gate rules in style.css, and list the data-app
   scripts as ordinary <script> tags at the end of <body>. */
(function () {
  const SALT = "survey-dictionary:";
  const HASH = "06889664ecdd1f2d32df5aa11aaef928bea4ed9f44aa0419dd2f397540245e3b";
  const KEY = "sd-gate";
  const APP = document.currentScript.dataset.app.split(" ");
  const root = document.documentElement;

  const isOpen = () => { try { return sessionStorage.getItem(KEY) === HASH; } catch (e) { return false; } };
  const remember = () => { try { sessionStorage.setItem(KEY, HASH); } catch (e) { /* asked again on the next load */ } };

  // data-app in index.html lists app.js last: it starts loading data the moment it runs,
  // and that data can arrive before a script listed after it has loaded.
  const startApp = () => {
    for (const src of APP) {
      const s = document.createElement("script");
      s.src = src;
      s.async = false; // run in the listed order
      document.body.appendChild(s);
    }
  };

  const sha256 = async text => {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const showGate = () => {
    const gate = document.createElement("div");
    gate.className = "gate";
    gate.innerHTML = `<form class="gate-card">
      <h1>Survey Dictionary</h1>
      <p>This site is still being built. Enter the password to continue.</p>
      <label class="field"><span>Password</span>
        <input id="gatePassword" type="password" autocomplete="current-password" required></label>
      <button type="submit" class="btn primary">Open</button>
      <p class="err" id="gateError" role="alert"></p>
    </form>`;
    document.body.prepend(gate);
    const input = gate.querySelector("#gatePassword");
    const error = gate.querySelector("#gateError");
    input.focus();
    gate.querySelector("form").addEventListener("submit", async e => {
      e.preventDefault();
      error.textContent = "";
      let ok = false;
      try {
        ok = await sha256(SALT + input.value) === HASH;
      } catch (err) {
        console.error(err);
        error.textContent = "This browser could not check the password here.";
        return;
      }
      if (!ok) {
        error.textContent = "That password is not right.";
        input.select();
        return;
      }
      remember();
      gate.remove();
      root.classList.remove("gate-locked");
      startApp();
    });
  };

  const open = isOpen();
  if (!open) root.classList.add("gate-locked");
  document.addEventListener("DOMContentLoaded", open ? startApp : showGate);
})();

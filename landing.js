/* ============ THE OFFICE — landing ("keep it alive") ============
   Front door of The Office. Same manifesto + split calculator as before,
   but the crew wall is now real: joining signs you in (name + PIN, shared
   with the rest of the app via localStorage) and adds you to the shared
   office_members table, live across every device.
   ================================================================ */
(function () {
  "use strict";

  /* ---- identity (shared with the app: same cb_auth key) ---- */
  function loadAuth() { try { return JSON.parse(localStorage.getItem("cb_auth") || "null"); } catch (e) { return null; } }
  function saveAuth(a) { try { localStorage.setItem("cb_auth", JSON.stringify(a)); } catch (e) {} }
  let auth = loadAuth();

  function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    const first = parts[0] ? parts[0][0] : "?";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase();
  }

  /* ---- crew wall (live from Supabase) ---- */
  const listEl = document.getElementById("memberList");
  const countEl = document.getElementById("memberCount");
  let members = [];

  function renderWall(freshName) {
    listEl.innerHTML = "";
    if (!members.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Be the first to put your name down.";
      listEl.appendChild(li);
    } else {
      members.forEach((m) => {
        const li = document.createElement("li");
        if (m.name === freshName) li.className = "fresh";
        const av = document.createElement("span");
        av.className = "avatar";
        av.textContent = initials(m.name);
        const nm = document.createElement("span");
        nm.textContent = m.name;
        li.appendChild(av);
        li.appendChild(nm);
        listEl.appendChild(li);
      });
    }
    countEl.textContent = members.length + (members.length === 1 ? " in" : " in");
  }

  async function loadCrew(freshName) {
    try {
      const { data, error } = await sb.from("office_members").select("name,joined_at").order("joined_at", { ascending: true });
      if (!error) members = data || [];
    } catch (e) { /* keep last */ }
    renderWall(freshName);
  }

  /* ---- join form (name + PIN -> auth_user + join_office) ---- */
  const form = document.getElementById("joinForm");
  const note = document.getElementById("joinNote");
  const nameField = document.getElementById("name");
  const pinField = document.getElementById("pin");
  if (auth && nameField) nameField.value = auth.name;

  if (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      const name = nameField.value.trim();
      const pin = (pinField.value || "").trim();
      if (name.length < 2) {
        note.textContent = "Please enter your name to join.";
        note.className = "join__note err"; nameField.focus(); return;
      }
      if (pin.length < 4) {
        note.textContent = "Pick a PIN (4+ digits) — it's how you sign in everywhere.";
        note.className = "join__note err"; pinField.focus(); return;
      }
      const btn = form.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      note.textContent = "Signing you in…"; note.className = "join__note";
      try {
        let r = await sb.rpc("auth_user", { p_name: name, p_pin: pin });
        if (r.error) throw r.error;
        r = await sb.rpc("join_office", { p_name: name, p_pin: pin, p_pledge: 0 });
        if (r.error) throw r.error;
        auth = { name: name, pin: pin };
        saveAuth(auth);
        await loadCrew(name);
        note.textContent = "You're in, " + name + ". The spot stays alive. Your desk is waiting.";
        note.className = "join__note ok";
        if (pinField) pinField.value = "";
      } catch (err) {
        note.textContent = (err && err.message) ? err.message : "Something went wrong — try again.";
        note.className = "join__note err";
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  loadCrew();
  sb.channel("crew").on("postgres_changes", { event: "*", schema: "public", table: "office_members" }, () => loadCrew()).subscribe();

  /* ---- split calculator ---- */
  const CUR = "JD";
  const rentEl = document.getElementById("rent");
  const peopleEl = document.getElementById("people");
  const peopleVal = document.getElementById("peopleVal");
  const shareOut = document.getElementById("shareOut");
  const shareFoot = document.getElementById("shareFoot");
  function calcSplit() {
    const rent = Math.max(0, parseFloat(rentEl.value) || 0);
    const people = Math.max(1, parseInt(peopleEl.value, 10) || 1);
    const rounded = Math.round(rent / people);
    peopleVal.textContent = people;
    shareOut.textContent = CUR + " " + rounded.toLocaleString();
    if (rent === 0) shareFoot.textContent = "pop in the rent above to see your share.";
    else if (rounded <= 60) shareFoot.textContent = "cheaper than a couple nights out. easy.";
    else if (rounded <= 120) shareFoot.textContent = "the whole spot for less than a phone bill each.";
    else shareFoot.textContent = "get one more homie in and it drops again.";
  }
  if (rentEl) { [rentEl, peopleEl].forEach((el) => el.addEventListener("input", calcSplit)); calcSplit(); }

  /* ---- count-up + scroll reveal ---- */
  function countUp(el) {
    const target = parseInt(el.dataset.count, 10) || 0;
    const dur = 1100, start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  const revealEls = document.querySelectorAll(".section, .hero__meta, .spacecard, .feature");
  revealEls.forEach((el) => el.classList.add("reveal"));
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      if (entry.target.classList.contains("hero__meta")) entry.target.querySelectorAll(".num").forEach(countUp);
      io.unobserve(entry.target);
    });
  }, { threshold: 0.12 });
  revealEls.forEach((el) => io.observe(el));
})();

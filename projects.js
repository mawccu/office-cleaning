/* ============================================================
   Projects — one service of The Office.

   Post a project, define the roles you need (with slots), and people
   join into a role. Everyone sees who's in. The owner runs it: sets
   status (open / active / done), adds roles, removes people. Built on core.js.
   ============================================================ */

let projects = [];
let roles = [];      // project_roles across all projects
let members = [];    // project_members across all projects

// composer state
let pTitle = "", pDesc = "";
let newRoles = [];   // [{ role, slots }] being composed

const composerEl = document.getElementById("composer");
const listEl = document.getElementById("projectList");
const statOpenEl = document.getElementById("statOpen");
const statInEl = document.getElementById("statIn");

// ---- derived ----
function rolesFor(pid) { return roles.filter((r) => r.project_id === pid); }
function membersFor(pid) { return members.filter((m) => m.project_id === pid); }
function filledFor(pid, role) { return membersFor(pid).filter((m) => m.role === role).length; }
function myMembership(pid) { return auth ? membersFor(pid).find((m) => m.member_name === auth.name) : null; }
const STATUS = { open: "Open", active: "Active", done: "Done" };

/* ============================================================
   Composer — create a project
   ============================================================ */
function composerBeingTyped() {
  const a = document.activeElement;
  return a && composerEl.contains(a) && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
}
function renderComposer() {
  if (!auth) {
    composerEl.innerHTML = `<div class="composer-empty"><div class="ce-title">Start a project</div><div class="ce-sub">Sign in with your name and a PIN to post a project and pull a crew together.</div><button class="btn primary" id="composerSignIn">Sign in</button></div>`;
    document.getElementById("composerSignIn").addEventListener("click", () => openAuth());
    return;
  }
  const roleChips = newRoles.length
    ? `<div class="team-chips">${newRoles.map((r, i) => `<span class="team-chip">${esc(r.role)} <span class="team-role">${r.slots} slot${r.slots > 1 ? "s" : ""}</span><button class="team-x" data-rm="${i}" title="Remove">×</button></span>`).join("")}</div>`
    : `<div class="composer-note">No roles yet — add the ones you need (or leave empty for an open crew).</div>`;
  composerEl.innerHTML = `
    <div class="card-head"><span>Start a project</span><span class="hint">as ${esc(auth.name)}</span></div>
    <div class="card-body">
      <input id="pTitle" class="fld" type="text" maxlength="120" placeholder="Project name — e.g. Redo the break room" value="${esc(pTitle)}" />
      <textarea id="pDesc" class="fld note" rows="2" placeholder="What's it about? (optional)">${esc(pDesc)}</textarea>
      <div class="composer-sub">Roles you need</div>
      <div class="bid-form">
        <input id="roleName" class="fld" type="text" maxlength="40" placeholder="Role — e.g. Design" />
        <input id="roleSlots" class="fld" type="number" min="1" max="99" step="1" value="1" style="width:84px;flex:0 0 auto" />
        <button type="button" id="addRoleBtn" class="btn ghost">Add</button>
      </div>
      ${roleChips}
      <div class="bid-form" style="margin-top:12px">
        <button id="createProjBtn" class="btn primary">Post project</button>
      </div>
    </div>`;
  const titleEl = document.getElementById("pTitle");
  const descEl = document.getElementById("pDesc");
  titleEl.addEventListener("input", () => { pTitle = titleEl.value; });
  descEl.addEventListener("input", () => { pDesc = descEl.value; });
  document.getElementById("addRoleBtn").addEventListener("click", () => {
    const rn = document.getElementById("roleName");
    const rs = document.getElementById("roleSlots");
    const role = rn.value.trim();
    const slots = Math.max(1, parseInt(rs.value, 10) || 1);
    if (!role) return toast("Name the role");
    if (newRoles.some((r) => r.role.toLowerCase() === role.toLowerCase())) return toast("That role's already added");
    newRoles.push({ role, slots });
    renderComposer();
    setTimeout(() => document.getElementById("roleName")?.focus(), 20);
  });
  composerEl.querySelectorAll("[data-rm]").forEach((el) => el.addEventListener("click", () => {
    newRoles.splice(Number(el.dataset.rm), 1); renderComposer();
  }));
  document.getElementById("createProjBtn").addEventListener("click", onCreateProject);
}
async function onCreateProject() {
  if (!requireAuth(onCreateProject)) return;
  const title = (document.getElementById("pTitle")?.value ?? pTitle).trim();
  if (!title) return toast("Give the project a name");
  const desc = (document.getElementById("pDesc")?.value ?? pDesc).trim();
  const ok = await callRpc("create_project",
    { p_title: title, p_desc: desc || null, p_roles: newRoles },
    "Project posted");
  if (ok) { pTitle = ""; pDesc = ""; newRoles = []; renderComposer(); }
}

/* ============================================================
   Project cards
   ============================================================ */
function projectCard(p) {
  const iAmOwner = auth && p.owner_name === auth.name;
  const mine = myMembership(p.id);
  const prs = rolesFor(p.id);
  const mem = membersFor(p.id);

  // roles with fill state
  const rolesHtml = prs.length
    ? `<div class="roles-row">${prs.map((r) => {
        const filled = filledFor(p.id, r.role);
        const full = filled >= r.slots;
        return `<span class="role-chip ${full ? "full" : "open"}">${esc(r.role)} <b>${filled}/${r.slots}</b>${iAmOwner ? `<button class="team-x" data-act="removerole" data-id="${p.id}" data-role="${esc(r.role)}" title="Remove role">×</button>` : ""}</span>`;
      }).join("")}</div>`
    : "";

  // who's in
  const whoHtml = `<div class="team-chips who-in">${mem.map((m) => `<span class="team-chip ${m.is_owner ? "claimer" : "accepted"}">${esc(m.member_name)}${m.role && m.role !== "owner" ? `<span class="team-role">${esc(m.role)}</span>` : m.is_owner ? `<span class="team-role">owner</span>` : ""}${iAmOwner && !m.is_owner ? `<button class="team-x" data-act="removemember" data-id="${p.id}" data-member="${esc(m.member_name)}" title="Remove">×</button>` : ""}</span>`).join("")}</div>`;

  // join control (non-member, not done)
  let joinHtml = "";
  if (!mine && p.status !== "done") {
    const openRoles = prs.filter((r) => filledFor(p.id, r.role) < r.slots);
    if (prs.length) {
      joinHtml = openRoles.length
        ? `<div class="join-row"><select class="fld role-select" data-id="${p.id}">${openRoles.map((r) => `<option value="${esc(r.role)}">${esc(r.role)} (${r.slots - filledFor(p.id, r.role)} left)</option>`).join("")}</select><button class="btn claim small" data-act="join" data-id="${p.id}">Join</button></div>`
        : `<div class="composer-note">All roles are full.</div>`;
    } else {
      joinHtml = `<button class="btn claim small" data-act="join" data-id="${p.id}">Join</button>`;
    }
  }

  // owner status controls
  const statusCtl = iAmOwner
    ? `<div class="status-ctl">${Object.keys(STATUS).map((s) => `<button class="chip-btn ${p.status === s ? "on" : ""}" data-act="status" data-id="${p.id}" data-status="${s}">${STATUS[s]}</button>`).join("")}</div>`
    : `<span class="status-badge ${p.status === "done" ? "cleaned" : "claimed"}">${STATUS[p.status]}</span>`;

  return `<div class="proj-card">
    <div class="proj-head">
      <div class="bid-who">${avatarHtml(p.owner_name)}<div><div class="bid-name">${esc(p.title)}</div><div class="bid-subline">by ${esc(p.owner_name)} · ${mem.length} in</div></div></div>
      ${statusCtl}
    </div>
    ${p.description ? `<div class="bid-note">${esc(p.description)}</div>` : ""}
    ${rolesHtml}
    <div class="proj-sub">Who's in</div>
    ${whoHtml}
    <div class="bid-actions proj-actions">
      ${joinHtml}
      ${mine && !mine.is_owner ? `<button class="btn ghost small" data-act="leave" data-id="${p.id}">Leave</button>` : ""}
      ${iAmOwner ? `<button class="btn ghost small" data-act="addrole" data-id="${p.id}">Add role</button><button class="btn ghost small" data-act="edit" data-id="${p.id}">Edit</button><button class="btn danger small" data-act="delete" data-id="${p.id}">Delete</button>` : ""}
    </div>
  </div>`;
}

function wireProjectActions() {
  document.querySelectorAll("[data-act][data-id]").forEach((el) => {
    const p = projects.find((x) => x.id === el.dataset.id);
    if (!p) return;
    el.addEventListener("click", () => {
      const act = el.dataset.act;
      if (act === "join") {
        const sel = listEl.querySelector(`.role-select[data-id="${p.id}"]`);
        const role = sel ? sel.value : null;
        callRpc("join_project", { p_id: p.id, p_role: role }, "You're in");
      } else if (act === "leave") callRpc("leave_project", { p_id: p.id }, "You left the project");
      else if (act === "status") callRpc("set_project_status", { p_id: p.id, p_status: el.dataset.status }, `Marked ${STATUS[el.dataset.status].toLowerCase()}`);
      else if (act === "removemember") callRpc("remove_member", { p_id: p.id, p_member: el.dataset.member }, "Removed");
      else if (act === "removerole") { if (confirm(`Remove the "${el.dataset.role}" role?`)) callRpc("remove_role", { p_id: p.id, p_role: el.dataset.role }, "Role removed"); }
      else if (act === "addrole") onAddRole(p);
      else if (act === "edit") onEditProject(p);
      else if (act === "delete") { if (confirm(`Delete project "${p.title}"? This can't be undone.`)) callRpc("cancel_project", { p_id: p.id }, "Project deleted"); }
    });
  });
}
function onAddRole(p) {
  const role = prompt("New role name:", "");
  if (role == null || !role.trim()) return;
  const slotsRaw = prompt(`How many slots for "${role.trim()}"?`, "1");
  if (slotsRaw == null) return;
  const slots = Math.max(1, parseInt(slotsRaw, 10) || 1);
  callRpc("add_role", { p_id: p.id, p_role: role.trim(), p_slots: slots }, "Role added");
}
function onEditProject(p) {
  const title = prompt("Project name:", p.title);
  if (title == null) return;
  const desc = prompt("Description (optional):", p.description || "");
  if (desc == null) return;
  callRpc("edit_project", { p_id: p.id, p_title: title, p_desc: desc || null }, "Project updated");
}

/* ============================================================
   Render + data
   ============================================================ */
function render() {
  if (!composerBeingTyped()) renderComposer();
  const active = projects.filter((p) => p.status !== "done");
  const done = projects.filter((p) => p.status === "done");
  const order = { open: 0, active: 1 };
  active.sort((a, b) => (order[a.status] - order[b.status]) || new Date(b.created_at) - new Date(a.created_at));
  done.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const all = [...active, ...done];
  listEl.innerHTML = all.length ? all.map(projectCard).join("") : emptyBlock("No projects yet. Start one above.");
  wireProjectActions();

  if (statOpenEl) statOpenEl.textContent = projects.filter((p) => p.status !== "done").length;
  if (statInEl) statInEl.textContent = new Set(members.map((m) => m.member_name)).size;
}
async function reload() {
  try {
    const [pr, rr, mr] = await Promise.all([
      sb.from("projects").select("*").order("created_at", { ascending: false }).limit(200),
      sb.from("project_roles").select("*").limit(1000),
      sb.from("project_members").select("*").limit(2000),
    ]);
    if (pr.error) throw pr.error;
    if (rr.error) throw rr.error;
    if (mr.error) throw mr.error;
    projects = pr.data || []; roles = rr.data || []; members = mr.data || [];
  } catch (e) {
    toast("Connection issue: " + (e.message || e));
  }
  render();
}
function subscribeRealtime() {
  sb.channel("projects-board")
    .on("postgres_changes", { event: "*", schema: "public", table: "projects" }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "project_roles" }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "project_members" }, reload)
    .subscribe();
}

// ---- boot ----
renderNav("projects");
onAuthChange = render;
afterWrite = reload;
render();
(async () => { await reload(); subscribeRealtime(); })();

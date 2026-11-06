/*
 * Team notes and photos are stored locally in this release.
 */
const SUPABASE_URL = "https://ukxnahlrdydtozzeppcd.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_f40hqLQysFb1Q9BkdCnlxg_dxKUwTd9";
const TEAM_CACHE_KEY = "smart_business_team_cache_v1";
const TEAM_SESSION_KEY = "smart_business_team_session_v1";
const TEAM_MEMBER_KEY = "smart_business_team_member_v1";
const TEAM_PENDING_SIGNUP_KEY = "smart_business_pending_signup_v1";

let teamData = { comments: [], photos: [] };
let teamCloudSession = null;
let teamCloudMember = null;
let teamCloudWorkspace = null;
let teamMembers = [];
let teamPhotoOffset = 0;
let teamPhotosLoaded = false;
let teamPhotosHaveMore = false;
const teamById = id => document.getElementById(id);
const teamUid = () => window.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

function teamReadCache() {
  try {
    const saved = localStorage.getItem(TEAM_CACHE_KEY);
    if (!saved) return { comments: [], photos: [] };
    const data = JSON.parse(saved);
    if (!data || !Array.isArray(data.comments) || !Array.isArray(data.photos)) {
      throw new Error("Saved team data has an invalid format.");
    }
    return { comments: data.comments, photos: [] };
  } catch (error) {
    console.error("Unable to read saved employee notes.", error);
    throw new Error("Saved team data could not be read from this browser.");
  }
}

function teamSaveCache() {
  try {
    const cache = {
      comments: teamKeepRecent(teamData.comments),
      photos: []
    };
    localStorage.setItem(TEAM_CACHE_KEY, JSON.stringify(cache));
    return true;
  } catch (error) {
    console.error("Unable to save employee notes.", error);
    teamStatus("Employee notes could not be saved on this device. Free up browser storage and try again.", "error");
    return false;
  }
}

function teamKeepRecent(items, maximum = 500) {
  const pending = items.filter(item => item.pending);
  const historyLimit = Math.max(0, maximum - pending.length);
  const history = historyLimit
    ? items.filter(item => !item.pending).slice(-historyLimit)
    : [];
  return [...history, ...pending].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function teamHasConfig() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL) &&
    SUPABASE_ANON_KEY.length > 20;
}

function teamStatus(message, state = "") {
  const status = teamById("teamCloudStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function teamLoadSession() {
  try {
    const raw = localStorage.getItem(TEAM_SESSION_KEY);
    teamCloudSession = raw ? JSON.parse(raw) : null;
    if (teamCloudSession && (typeof teamCloudSession.access_token !== "string" ||
      typeof teamCloudSession.refresh_token !== "string" || !teamCloudSession.user?.id)) {
      throw new Error("Saved cloud sign-in is invalid.");
    }
  } catch (error) {
    console.error("Unable to read cloud sign-in.", error);
    teamCloudSession = null;
    teamStatus("Cloud sign-in could not be restored. Sign in again.", "error");
  }
}

function teamStoreSession(session) {
  teamCloudSession = session;
  try {
    if (session) localStorage.setItem(TEAM_SESSION_KEY, JSON.stringify(session));
    else {
      localStorage.removeItem(TEAM_SESSION_KEY);
      localStorage.removeItem(TEAM_MEMBER_KEY);
    }
  } catch (error) {
    console.error("Unable to save cloud sign-in.", error);
    teamStatus("Cloud sign-in could not be saved on this device.", "error");
  }
}

function teamLoadMemberCache() {
  if (!teamCloudSession) return;
  try {
    const raw = localStorage.getItem(TEAM_MEMBER_KEY);
    if (!raw) return;
    const cached = JSON.parse(raw);
    if (!cached || cached.userId !== teamCloudSession.user.id ||
      !cached.member || !Array.isArray(cached.members) ||
      !["admin", "agent"].includes(cached.member.role)) {
      throw new Error("Saved team membership is invalid.");
    }
    teamCloudMember = cached.member;
    teamCloudWorkspace = cached.member.workspace_id;
    teamMembers = cached.members;
  } catch (error) {
    console.error("Unable to read saved team membership.", error);
    teamCloudMember = null;
    teamCloudWorkspace = null;
    teamMembers = [];
    teamStatus("Saved team membership could not be read. Reconnect while online.", "error");
  }
}

function teamSaveMemberCache() {
  if (!teamCloudSession || !teamCloudMember) return;
  try {
    localStorage.setItem(TEAM_MEMBER_KEY, JSON.stringify({
      userId: teamCloudSession.user.id,
      member: teamCloudMember,
      members: teamMembers
    }));
  } catch (error) {
    console.error("Unable to save team membership.", error);
    teamStatus("Team membership could not be cached for offline use.", "error");
  }
}

function teamReadPendingSignup() {
  try {
    const raw = localStorage.getItem(TEAM_PENDING_SIGNUP_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!pending || !["admin", "agent"].includes(pending.role) ||
      typeof pending.username !== "string" ||
      typeof pending.userId !== "string" ||
      (pending.role === "admin" && typeof pending.workspaceName !== "string") ||
      (pending.role === "agent" && typeof pending.inviteCode !== "string")) {
      throw new Error("Pending cloud account data is invalid.");
    }
    return pending;
  } catch (error) {
    console.error("Unable to read pending cloud account setup.", error);
    teamStatus("Pending cloud account setup could not be read. Sign up again.", "error");
    return null;
  }
}

function teamSavePendingSignup(pending) {
  try {
    localStorage.setItem(TEAM_PENDING_SIGNUP_KEY, JSON.stringify(pending));
  } catch (error) {
    console.error("Unable to save pending cloud account setup.", error);
    throw new Error("The cloud account is waiting for email verification, but its setup could not be saved on this device.");
  }
}

async function teamFinishPendingSignup(username, role) {
  const pending = teamReadPendingSignup();
  if (!pending || pending.username !== username || pending.role !== role) return false;
  if (pending.userId !== teamCloudSession?.user?.id) return false;
  if (role === "admin") {
    await teamRpc("create_workspace", {
      workspace_name: pending.workspaceName,
      member_username: pending.username
    });
  } else {
    await teamRpc("join_workspace", {
      invite_code: pending.inviteCode,
      member_username: pending.username
    });
  }
  localStorage.removeItem(TEAM_PENDING_SIGNUP_KEY);
  return true;
}

async function teamAuthRequest(path, body) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.msg || result.message || result.error_description || "Cloud sign-in failed.");
  return result;
}

async function teamRefreshSession() {
  if (!teamCloudSession?.refresh_token) throw new Error("Cloud sign-in expired. Sign in again.");
  const session = await teamAuthRequest("token?grant_type=refresh_token", {
    refresh_token: teamCloudSession.refresh_token
  });
  teamStoreSession(session);
}

async function teamRequest(path, options = {}, retry = true) {
  if (!teamHasConfig()) throw new Error("Add your Supabase project URL and public anon key in collaboration.js first.");
  if (!teamCloudSession?.access_token) throw new Error("Sign in to the cloud to share team data.");
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${teamCloudSession.access_token}`,
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (response.status === 401 && retry) {
    await teamRefreshSession();
    return teamRequest(path, options, false);
  }
  const text = await response.text();
  let result = null;
  if (text) {
    try { result = JSON.parse(text); }
    catch (error) { throw new Error("The cloud returned an unreadable response."); }
  }
  if (!response.ok) {
    throw new Error(result?.message || result?.hint || result?.details || "The cloud request was rejected.");
  }
  return result;
}

async function teamRpc(name, args = {}) {
  if (!teamHasConfig() || !teamCloudSession?.access_token) {
    throw new Error("Sign in to a configured cloud project first.");
  }
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${teamCloudSession.access_token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(args)
  });
  const text = await response.text();
  let result = null;
  if (text) {
    try { result = JSON.parse(text); }
    catch (error) { throw new Error("The cloud returned an unreadable response."); }
  }
  if (!response.ok) throw new Error(result?.message || result?.hint || "The cloud request was rejected.");
  return result;
}

async function teamGetMembership() {
  const rows = await teamRequest(`team_members?select=user_id,workspace_id,username,role&user_id=eq.${encodeURIComponent(teamCloudSession.user.id)}&limit=1`);
  const member = rows?.[0];
  if (!member) throw new Error("This cloud account is not part of a business workspace yet.");
  if (currentRole && (member.username !== currentUsername || member.role !== currentRole)) {
    throw new Error("The cloud account is linked to a different app username or role. Sign in with the matching account.");
  }
  if (teamCloudWorkspace !== member.workspace_id) {
    teamData.photos = [];
    teamPhotoOffset = 0;
    teamPhotosLoaded = false;
    teamPhotosHaveMore = false;
  }
  teamCloudMember = member;
  teamCloudWorkspace = member.workspace_id;
  teamMembers = await teamRequest(`team_members?select=user_id,username,role&workspace_id=eq.${encodeURIComponent(teamCloudWorkspace)}&order=username.asc`);
  teamSaveMemberCache();
}

async function teamCloudLoginFromLogin(signUp) {
  if (!teamHasConfig()) {
    teamById("teamCloudLoginStatus").textContent = "Set SUPABASE_URL and SUPABASE_ANON_KEY in collaboration.js, then publish the app again.";
    return;
  }
  const username = normalizeUsername(teamById("username").value);
  const role = loginRole;
  const email = teamById("teamCloudLoginEmail").value.trim();
  const password = teamById("teamCloudLoginPassword").value;
  const status = teamById("teamCloudLoginStatus");
  const workspaceName = teamById("teamCloudLoginWorkspace").value.trim();
  const inviteCode = teamById("teamCloudLoginInvite").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[a-z0-9][a-z0-9 ._-]{1,30}[a-z0-9]$/.test(username)) {
    status.textContent = "Enter a valid 3–32 character username above.";
    return;
  }
  if (!email || password.length < 8) {
    status.textContent = "Enter a valid email address and a cloud password of at least 8 characters.";
    return;
  }
  if (signUp && role === "admin" && !workspaceName) {
    status.textContent = "Enter a business name for the owner workspace.";
    return;
  }
  if (signUp && role === "agent" && !inviteCode) {
    status.textContent = "Enter the employee cloud access code from the owner.";
    return;
  }
  status.textContent = signUp ? "Creating your cloud account…" : "Signing in to the cloud…";
  try {
    const session = await teamAuthRequest(signUp ? "signup" : "token?grant_type=password", { email, password });
    const pending = signUp ? {
      role,
      username,
      userId: session.user?.id || "",
      ...(role === "admin" ? { workspaceName } : { inviteCode })
    } : null;
    if (!session.access_token) {
      teamSavePendingSignup(pending);
      status.textContent = "Cloud account created. Verify your email, then sign in here.";
      return;
    }
    teamStoreSession(session);
    if (pending) teamSavePendingSignup(pending);
    if (signUp) {
      if (role === "admin") {
        await teamRpc("create_workspace", { workspace_name: workspaceName, member_username: username });
      } else {
        await teamRpc("join_workspace", { invite_code: inviteCode, member_username: username });
      }
    }
    try {
      await teamGetMembership();
    } catch (error) {
      if (!await teamFinishPendingSignup(username, role)) throw error;
      await teamGetMembership();
    }
    if (teamCloudMember.username !== username || teamCloudMember.role !== role) {
      throw new Error("The cloud account username or role does not match the selected app account.");
    }
    localStorage.removeItem(TEAM_PENDING_SIGNUP_KEY);
    status.textContent = "Cloud sign-in successful.";
    teamById("teamCloudLoginPassword").value = "";
    enter(role, username);
    try { await teamUploadProductPhotos(); }
    catch (error) {
      console.error("Unable to sync product photos after cloud sign-in.", error);
      teamStatus(`Connected, but product photos could not sync: ${error.message}`, "error");
    }
    await teamSyncNow();
  } catch (error) {
    console.error("Unable to sign in to the team cloud.", error);
    teamStoreSession(null);
    teamCloudMember = null;
    teamCloudWorkspace = null;
    teamMembers = [];
    status.textContent = error.message || "Cloud sign-in failed. Check your connection and account details.";
  }
}

function teamUpdateCloudControls() {
  const connected = Boolean(teamCloudSession && teamCloudMember);
  teamById("teamCloudSignIn").hidden = connected;
  teamById("teamCloudSignUp").hidden = connected;
  teamById("teamCloudSignOut").hidden = !connected;
  teamById("teamCreateInvite").hidden = !connected || currentRole !== "admin";
  teamById("teamWorkspaceField").hidden = currentRole !== "admin";
  teamById("teamInviteField").hidden = currentRole !== "agent";
  teamById("teamCommentForm").hidden = currentRole !== "admin";
  teamById("teamCommentEmployeeField").hidden = currentRole !== "admin";
}

function teamEmployeeOptions() {
  if (teamCloudMember) return teamMembers.filter(member => member.role === "agent");
  try {
    return readAccounts().filter(account => account.role === "agent").map(account => ({
      user_id: account.username,
      username: account.username,
      role: "agent"
    }));
  } catch (error) {
    console.error("Unable to list employee accounts for comments.", error);
    return [];
  }
}

function teamFillEmployeeSelect(select, selectedValue) {
  if (!select) return;
  const employees = teamEmployeeOptions();
  const previous = selectedValue || select.value;
  select.innerHTML = employees.map(employee =>
    `<option value="${esc(employee.user_id)}" data-username="${esc(employee.username)}">${esc(employee.username)}</option>`
  ).join("") || '<option value="">No employee accounts found</option>';
  if (employees.some(employee => employee.user_id === previous)) select.value = previous;
}

function teamCommentEmployee() {
  const select = teamById("teamCommentEmployee");
  const option = select?.selectedOptions?.[0];
  return option ? { id: option.value, username: option.dataset.username || option.textContent } : null;
}

function teamRenderComments() {
  const employee = currentRole === "admin" ? teamCommentEmployee() : null;
  const employeeId = currentRole === "admin" ? employee?.id : teamCloudMember?.user_id || currentUsername;
  const employeeKey = currentRole === "admin" ? employee?.username : currentUsername;
  const comments = teamData.comments.filter(comment =>
    (comment.employeeId && comment.employeeId === employeeId) ||
    (comment.employeeKey && comment.employeeKey === employeeKey)
  ).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  teamById("teamComments").innerHTML = comments.map(comment => {
    const date = new Date(comment.createdAt);
    return `<div class="item"><div class="iteminfo"><strong>${esc(comment.author || "Owner")}</strong><small>${esc(Number.isNaN(date.getTime()) ? "Saved offline" : date.toLocaleString())}${comment.pending ? " · Waiting to sync" : ""}</small><small>${esc(comment.body || "")}</small></div></div>`;
  }).join("") || '<p class="muted">No comments for this employee yet.</p>';
}

function teamRenderPhotos() {
  const products = Array.isArray(db.products) ? db.products.filter(product => product.image) : [];
  const localPhotos = products.map(product => ({
    id: product.id,
    name: product.name,
    category: product.category,
    image: product.image,
    addedBy: product.addedBy
  }));
  const photos = new Map();
  [...teamData.photos, ...localPhotos].forEach(photo => {
    if (photo.image) photos.set(photo.id, photo);
  });
  teamById("teamProductPhotos").innerHTML = [...photos.values()].map(photo =>
    `<article class="team-photo"><img src="${esc(photo.image)}" alt="${esc(photo.name || "Product photo")}"><div><strong>${esc(photo.name || "Product")}</strong><br>${esc(photo.category || "Uncategorised")}${photo.addedBy ? `<br>Added by ${esc(photo.addedBy)}` : ""}</div></article>`
  ).join("") || '<p class="muted">No product photos have been added.</p>';
  teamById("teamLoadMorePhotos").hidden = !teamCloudMember || !teamPhotosHaveMore;
}

function renderTeam() {
  if (!teamById("team")) return;
  if (!currentRole) return;
  teamUpdateCloudControls();
  teamFillEmployeeSelect(teamById("teamCommentEmployee"));
  teamById("teamCommentText").disabled = currentRole === "admin" && !teamCommentEmployee();
  teamRenderComments();
  teamRenderPhotos();
  teamById("teamRefreshNotes").hidden = !teamCloudMember;
  if (!teamHasConfig()) {
    teamStatus("Offline comments and product photos are available on this device. Add Supabase details in collaboration.js to sync them across devices.", "error");
    return;
  }
  if (teamCloudMember) {
    teamStatus(`Connected as ${teamCloudMember.username}. Employee comments and product photos sync when online.`, "ok");
  } else {
    teamStatus("Cloud is configured. Sign in with your cloud account to join this business workspace.");
  }
}

async function teamSignIn(signUp) {
  if (!teamHasConfig()) {
    teamStatus("Set SUPABASE_URL and SUPABASE_ANON_KEY in collaboration.js, then publish the app again.", "error");
    return;
  }
  const email = teamById("teamEmail").value.trim();
  const password = teamById("teamPassword").value;
  const workspaceName = teamById("teamWorkspaceName").value.trim();
  const inviteCode = teamById("teamInviteCode").value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!email || password.length < 8) {
    teamStatus("Enter a valid email address and a cloud password of at least 8 characters.", "error");
    return;
  }
  if (signUp && currentRole === "admin" && !workspaceName) {
    teamStatus("Enter a business name for the owner workspace.", "error");
    return;
  }
  if (signUp && currentRole === "agent" && !inviteCode) {
    teamStatus("Enter the employee cloud access code from the owner.", "error");
    return;
  }
  teamStatus(signUp ? "Creating your cloud account…" : "Signing in to the cloud…");
  try {
    const response = await teamAuthRequest(signUp ? "signup" : "token?grant_type=password", {
      email,
      password
    });
    const pending = signUp ? {
      role: currentRole,
      username: currentUsername,
      userId: response.user?.id || "",
      ...(currentRole === "admin" ? { workspaceName } : { inviteCode })
    } : null;
    if (!response.access_token) {
      teamSavePendingSignup(pending);
      teamStatus("Cloud account created. Verify your email, then sign in here.", "ok");
      return;
    }
    teamStoreSession(response);
    if (pending) teamSavePendingSignup(pending);
    if (signUp) {
      const username = currentUsername;
      if (currentRole === "admin") {
        await teamRpc("create_workspace", { workspace_name: workspaceName, member_username: username });
      } else {
        await teamRpc("join_workspace", { invite_code: inviteCode, member_username: username });
      }
    }
    try {
      await teamGetMembership();
    } catch (error) {
      if (!await teamFinishPendingSignup(currentUsername, currentRole)) throw error;
      await teamGetMembership();
    }
    localStorage.removeItem(TEAM_PENDING_SIGNUP_KEY);
    teamStatus(`Connected as ${teamCloudMember.username}. Team data will sync when online.`, "ok");
    teamUpdateCloudControls();
    await teamUploadProductPhotos();
    await teamSyncNow();
  } catch (error) {
    console.error("Unable to connect the team cloud account.", error);
    teamStatus(error.message || "Cloud sign-in failed. Check your connection and account details.", "error");
    teamStoreSession(null);
    teamCloudMember = null;
    teamCloudWorkspace = null;
    teamMembers = [];
  }
  renderTeam();
}

async function teamCreateInvite() {
  if (currentRole !== "admin" || !teamCloudMember) return;
  try {
    const code = await teamRpc("create_team_invite");
    const value = typeof code === "string" ? code : Array.isArray(code) ? code[0] : code?.create_team_invite;
    if (!value) throw new Error("The cloud did not return an access code.");
    teamById("teamInviteCode").value = value;
    teamStatus(`Employee access code: ${value}. Give this code to an employee to join your cloud workspace.`, "ok");
  } catch (error) {
    console.error("Unable to create an employee cloud code.", error);
    teamStatus(error.message || "The employee access code could not be created.", "error");
  }
}

async function teamSignOut() {
  try {
    if (teamCloudSession?.access_token && teamHasConfig()) {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: "POST",
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${teamCloudSession.access_token}`
        }
      });
    }
  } catch (error) {
    console.error("Unable to end the cloud session cleanly.", error);
  }
  teamStoreSession(null);
  teamCloudMember = null;
  teamCloudWorkspace = null;
  teamMembers = [];
  if (currentRole) teamStatus("Disconnected. Offline employee comments remain saved on this device.");
  renderTeam();
}

async function teamSyncNow() {
  if (!teamCloudMember || !navigator.onLine) return;
  try {
    await teamPushPendingComments();
    await Promise.all([teamLoadComments(), teamLoadPhotos()]);
    teamSaveCache();
    renderTeam();
  } catch (error) {
    console.error("Unable to sync employee notes and photos.", error);
    teamStatus(`Offline or sync failed: ${error.message}. Employee comments remain saved on this device.`, "error");
  }
}

async function teamPushPendingComments() {
  const pendingComments = teamData.comments.filter(comment => comment.pending);
  for (const comment of pendingComments) {
    await teamRequest("employee_comments", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: {
        id: comment.id,
        workspace_id: teamCloudWorkspace,
        employee_id: comment.employeeId,
        owner_id: teamCloudMember.user_id,
        owner_username: currentUsername,
        body: comment.body,
        created_at: comment.createdAt
      }
    });
    comment.pending = false;
  }
}

async function teamLoadComments() {
  const employee = currentRole === "admin" ? teamCommentEmployee() : null;
  const employeeId = currentRole === "admin" ? employee?.id : teamCloudMember.user_id;
  if (!employeeId || employeeId === "undefined") return;
  const rows = await teamRequest(`employee_comments?select=id,employee_id,owner_username,body,created_at&workspace_id=eq.${encodeURIComponent(teamCloudWorkspace)}&employee_id=eq.${encodeURIComponent(employeeId)}&order=created_at.desc&limit=100`);
  const remote = rows.reverse().map(row => ({
    id: row.id,
    employeeId: row.employee_id,
    employeeKey: currentRole === "admin" ? employee?.username : currentUsername,
    author: row.owner_username,
    body: row.body,
    createdAt: row.created_at,
    pending: false
  }));
  teamData.comments = teamKeepRecent([...teamData.comments.filter(comment => comment.pending || comment.employeeId !== employeeId), ...remote]);
}

async function teamLoadPhotos(reset = false) {
  if (!reset && teamPhotosLoaded) return;
  if (reset) {
    teamPhotoOffset = 0;
    teamPhotosLoaded = false;
  }
  const rows = await teamRequest(`product_photos?select=id,product_name,category,image,added_by,updated_at&workspace_id=eq.${encodeURIComponent(teamCloudWorkspace)}&order=updated_at.desc&limit=20&offset=${teamPhotoOffset}`);
  const remote = rows.map(row => ({
    id: row.id,
    name: row.product_name,
    category: row.category,
    image: row.image,
    addedBy: teamMembers.find(member => member.user_id === row.added_by)?.username || ""
  }));
  if (reset) {
    teamData.photos = remote;
  } else {
    const remoteIds = new Set(remote.map(photo => photo.id));
    teamData.photos = [...teamData.photos.filter(photo => !remoteIds.has(photo.id)), ...remote];
  }
  teamPhotoOffset += remote.length;
  teamPhotosLoaded = true;
  teamPhotosHaveMore = remote.length === 20;
  teamById("teamLoadMorePhotos").hidden = !teamCloudMember || !teamPhotosHaveMore;
}

async function teamLoadMorePhotos() {
  if (!teamCloudMember || !teamPhotosHaveMore) return;
  teamPhotosLoaded = false;
  try {
    await teamLoadPhotos();
    renderTeam();
  } catch (error) {
    console.error("Unable to load more product photos.", error);
    teamStatus(`More product photos could not be loaded: ${error.message}`, "error");
  }
}

async function teamSaveComment(event) {
  event.preventDefault();
  if (currentRole !== "admin") return;
  const employee = teamCommentEmployee();
  const body = teamById("teamCommentText").value.trim();
  if (!employee || !body) return;
  if (teamData.comments.filter(comment => comment.pending).length >= 200) {
    teamStatus("The offline comments queue is full. Reconnect and sync before adding more comments.", "error");
    return;
  }
  const comment = {
    id: teamUid(),
    employeeId: teamCloudMember ? employee.id : "",
    employeeKey: employee.username,
    author: currentUsername,
    body,
    createdAt: new Date().toISOString(),
    pending: Boolean(teamCloudMember)
  };
  teamData.comments.push(comment);
  teamData.comments = teamKeepRecent(teamData.comments);
  if (!teamSaveCache()) return;
  teamById("teamCommentText").value = "";
  teamRenderComments();
  if (teamCloudMember) await teamSyncNow();
}

async function teamUploadProductPhotos() {
  if (!teamCloudMember || !navigator.onLine) return;
  const products = Array.isArray(db.products) ? db.products.filter(product => product.image) : [];
  for (const product of products) {
    if (!/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(product.image)) continue;
    await teamRequest("product_photos?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: {
        id: String(product.id),
        workspace_id: teamCloudWorkspace,
        product_name: String(product.name || "Product").slice(0, 120),
        category: String(product.category || "").slice(0, 80),
        image: product.image,
        added_by: teamCloudMember.user_id,
        updated_at: new Date().toISOString()
      }
    });
  }
}

function teamRender() {
  if (!teamById("team")) return;
  renderTeam();
  if (teamCloudMember && navigator.onLine) teamSyncNow();
}

try {
  teamData = teamReadCache();
} catch (error) {
  teamData = { comments: [], photos: [] };
  teamStatus(error.message || "Saved team data could not be loaded.", "error");
}
teamLoadSession();
teamLoadMemberCache();
teamUpdateCloudControls();

teamById("teamCloudForm").addEventListener("submit", event => {
  event.preventDefault();
  teamSignIn(false);
});
teamById("teamCloudSignUp").addEventListener("click", () => teamSignIn(true));
teamById("teamCloudSignOut").addEventListener("click", teamSignOut);
teamById("teamCreateInvite").addEventListener("click", teamCreateInvite);
teamById("teamCommentForm").addEventListener("submit", teamSaveComment);
teamById("teamCommentEmployee").addEventListener("change", () => {
  teamRenderComments();
  if (teamCloudMember) teamSyncNow();
});
teamById("teamRefreshNotes").addEventListener("click", async () => {
  try {
    await teamLoadPhotos(true);
    await teamSyncNow();
  } catch (error) {
    console.error("Unable to refresh employee comments and product photos.", error);
    teamStatus(`Refresh failed: ${error.message}`, "error");
  }
});
teamById("teamRefreshPhotos").addEventListener("click", async () => {
  if (!teamCloudMember) {
    teamStatus("Sign in to a cloud workspace to refresh shared product photos.", "error");
    return;
  }
  try {
    await teamLoadPhotos(true);
    renderTeam();
  } catch (error) {
    console.error("Unable to refresh product photos.", error);
    teamStatus(`Product photos could not be refreshed: ${error.message}`, "error");
  }
});
teamById("teamLoadMorePhotos").addEventListener("click", teamLoadMorePhotos);
window.addEventListener("online", async () => {
  if (!teamCloudMember) return;
  try {
    await teamUploadProductPhotos();
    await teamLoadPhotos(true);
    await teamSyncNow();
  } catch (error) {
    console.error("Unable to sync offline team changes.", error);
    teamStatus(`Offline changes remain saved on this device: ${error.message}`, "error");
  }
});
window.addEventListener("storage", event => {
  if (event.key === TEAM_CACHE_KEY) {
    teamData = teamReadCache();
    renderTeam();
  }
});

const originalRenderAllForTeam = renderAll;
renderAll = function () {
  originalRenderAllForTeam();
  renderTeam();
};

const originalPageForTeam = page;
page = function (id, button) {
  originalPageForTeam(id, button);
  if (id === "team") teamRender();
};

const originalReturnToLoginForTeam = returnToLogin;
returnToLogin = function () {
  originalReturnToLoginForTeam();
  teamSignOut();
};

const originalEnterForTeam = enter;
enter = function (role, username) {
  originalEnterForTeam(role, username);
  if (!teamCloudSession) return;
  if (teamCloudMember) {
    if (teamCloudMember.username !== username || teamCloudMember.role !== role) {
      teamCloudMember = null;
      teamCloudWorkspace = null;
      teamMembers = [];
      teamStatus("Cloud account does not match this local sign-in. Sign in to the cloud with the matching account.", "error");
      return;
    }
    renderTeam();
    if (navigator.onLine) teamSyncNow();
    return;
  }
  if (navigator.onLine) {
    teamGetMembership().then(() => {
      if (teamCloudMember.username !== username || teamCloudMember.role !== role) {
        throw new Error("Cloud account does not match this local sign-in.");
      }
      renderTeam();
      teamSyncNow();
    }).catch(error => {
      console.error("Unable to reconnect the saved cloud account.", error);
      teamStatus(error.message || "Reconnect the cloud account to access team data.", "error");
    });
  }
};

teamById("teamCloudLoginForm").addEventListener("submit", event => {
  event.preventDefault();
  teamCloudLoginFromLogin(false);
});
teamById("teamCloudLoginCreate").addEventListener("click", () => teamCloudLoginFromLogin(true));

const originalSelectLoginRoleForTeam = selectLoginRole;
selectLoginRole = function (role) {
  originalSelectLoginRoleForTeam(role);
  teamById("teamCloudLoginWorkspaceField").classList.toggle("hidden", role !== "admin");
  teamById("teamCloudLoginInviteField").classList.toggle("hidden", role !== "agent");
};
teamById("teamCloudLoginWorkspaceField").classList.toggle("hidden", loginRole !== "admin");
teamById("teamCloudLoginInviteField").classList.toggle("hidden", loginRole !== "agent");

const originalProductSubmitForTeam = teamById("productForm");
originalProductSubmitForTeam.addEventListener("submit", () => {
  window.setTimeout(async () => {
    if (!teamCloudMember || !navigator.onLine) return;
    try {
      await teamUploadProductPhotos();
      teamStatus("Product photos synced to the team cloud.", "ok");
      await teamLoadPhotos(true);
      renderTeam();
    } catch (error) {
      console.error("Unable to sync product photos.", error);
      teamStatus(`Product photos are saved offline. Sync failed: ${error.message}`, "error");
    }
  }, 300);
});

if (teamCloudSession && teamHasConfig()) {
  teamRefreshSession().then(() => {
    if (currentRole && navigator.onLine) return teamGetMembership();
  }).then(() => {
    if (teamCloudMember && currentRole) {
      return teamUploadProductPhotos().then(teamSyncNow);
    }
  }).catch(error => {
    console.error("Unable to restore team cloud connection.", error);
    teamStoreSession(null);
    teamStatus("Cloud session expired or could not be restored. Sign in again.", "error");
  });
}

window.setInterval(() => {
  if (currentRole && teamCloudMember && navigator.onLine) teamSyncNow();
}, 20000);

const BUSINESS_CLOUD_SESSION_KEY = "smart_business_records_session_v1";
let businessCloudSession = null;
let businessCloudSyncTimer = 0;
let businessCloudSyncedAt = "";
let businessCloudSyncedData = "";
let businessCloudBusy = false;
let businessCloudConflict = false;

function businessCloudConfigured() {
  return teamHasConfig();
}

function businessCloudEmail(username, role) {
  const encoded = btoa(unescape(encodeURIComponent(`${role}:${username}`)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return `sb-${encoded}@accounts.smart-business.invalid`;
}

function businessCloudStatus(message, state = "") {
  const status = teamById("teamCloudStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function businessCloudStoreSession(session) {
  businessCloudSession = session;
  try {
    if (session) localStorage.setItem(BUSINESS_CLOUD_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(BUSINESS_CLOUD_SESSION_KEY);
  } catch (error) {
    console.error("Unable to save business cloud sign-in.", error);
    throw new Error("Cloud sign-in could not be saved on this device.");
  }
}

function businessCloudLoadSession() {
  try {
    const raw = localStorage.getItem(BUSINESS_CLOUD_SESSION_KEY);
    businessCloudSession = raw ? JSON.parse(raw) : null;
    if (businessCloudSession && (typeof businessCloudSession.access_token !== "string" ||
      typeof businessCloudSession.refresh_token !== "string" ||
      typeof businessCloudSession.user?.id !== "string")) {
      throw new Error("Saved business cloud sign-in is invalid.");
    }
  } catch (error) {
    console.error("Unable to read business cloud sign-in.", error);
    businessCloudSession = null;
    businessCloudStatus("Cloud sign-in could not be restored. Sign in again.", "error");
  }
}

async function businessCloudAuth(path, body) {
  if (!businessCloudConfigured()) {
    throw new Error("Cross-device sync is not configured. Follow the Supabase setup steps in PUBLISH.txt.");
  }
  const response = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.msg || result.message || result.error_description ||
      result.error || "Cloud sign-in failed. Check your username and password.");
  }
  return result;
}

async function businessCloudRefresh() {
  if (!businessCloudSession?.refresh_token) throw new Error("Cloud sign-in expired. Sign in again.");
  const session = await businessCloudAuth("token?grant_type=refresh_token", {
    refresh_token: businessCloudSession.refresh_token
  });
  businessCloudStoreSession(session);
}

async function businessCloudRequest(path, options = {}, retry = true) {
  if (!businessCloudSession?.access_token) throw new Error("Sign in to your cloud account first.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${businessCloudSession.access_token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  if (response.status === 401 && retry) {
    await businessCloudRefresh();
    return businessCloudRequest(path, options, false);
  }
  const text = await response.text();
  let result = null;
  if (text) {
    try { result = JSON.parse(text); }
    catch (error) { throw new Error("The cloud returned an unreadable response."); }
  }
  if (!response.ok) {
    throw new Error(result?.message || result?.hint || result?.details ||
      "The cloud request was rejected. Check the Supabase database setup.");
  }
  return result;
}

function businessCloudRecordPath() {
  const userId = businessCloudSession?.user?.id;
  if (!userId) throw new Error("The cloud account is missing its user ID.");
  return `business_records?select=payload,updated_at&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
}

async function businessCloudReadRecord() {
  const rows = await businessCloudRequest(businessCloudRecordPath());
  return rows?.[0] || null;
}

function businessCloudApplyRecord(record) {
  const payload = record?.payload;
  const collections = ["products", "sales", "stock", "expenses", "customers"];
  if (!payload || typeof payload !== "object" ||
    collections.some(key => !Array.isArray(payload[key]))) {
    throw new Error("Cloud business data has an invalid format. The local records were left unchanged.");
  }
  const saved = localStorage.getItem(KEY);
  const serialized = JSON.stringify(payload);
  if (saved && saved !== serialized) {
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        fromVersion: "before cloud sync",
        savedAt: new Date().toISOString(),
        data: saved
      }));
    } catch (error) {
      console.error("Could not save a local safety copy before cloud sync.", error);
      throw new Error("A safety copy could not be saved, so cloud records were not loaded. Free up browser storage and try again.");
    }
  }
  localStorage.setItem(KEY, serialized);
  if (!load()) {
    try {
      if (saved === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, saved);
      load();
    } catch (error) {
      console.error("Unable to restore local records after invalid cloud data.", error);
    }
    throw new Error("Cloud business data could not be loaded. The local records were restored where possible.");
  }
  businessCloudSyncedData = JSON.stringify(db);
  businessCloudSyncedAt = record.updated_at || "";
  scheduleRenderAll();
}

async function businessCloudPush() {
  if (!businessCloudSession || !navigator.onLine || businessCloudBusy || businessCloudConflict) return false;
  businessCloudBusy = true;
  try {
    const serialized = JSON.stringify(db);
    if (serialized === businessCloudSyncedData) return true;
    const record = await businessCloudReadRecord();
    if (record && record.updated_at !== businessCloudSyncedAt) {
      businessCloudConflict = true;
      businessCloudStatus("Cloud data changed on another device. Your local records are unchanged; back them up before resolving this conflict.", "error");
      return false;
    }
    const body = {
      user_id: businessCloudSession.user.id,
      payload: JSON.parse(serialized)
    };
    const path = record
      ? `business_records?user_id=eq.${encodeURIComponent(businessCloudSession.user.id)}&updated_at=eq.${encodeURIComponent(businessCloudSyncedAt)}`
      : "business_records";
    const saved = await businessCloudRequest(path, {
      method: record ? "PATCH" : "POST",
      headers: { Prefer: "return=representation" },
      body
    });
    if (!Array.isArray(saved) || !saved[0]) {
      businessCloudConflict = true;
      businessCloudStatus("Cloud data changed on another device. Your local records are unchanged; back them up before resolving this conflict.", "error");
      return false;
    }
    businessCloudSyncedAt = saved[0].updated_at || "";
    businessCloudSyncedData = serialized;
    businessCloudStatus("Business records synced to your cloud account.", "ok");
    return true;
  } catch (error) {
    console.error("Unable to sync business records.", error);
    businessCloudStatus(`Cloud sync failed; your records remain saved on this device: ${error.message}`, "error");
    return false;
  } finally {
    businessCloudBusy = false;
  }
}

async function businessCloudConnect(username, role, password, signUp) {
  if (!businessCloudConfigured()) return false;
  const email = businessCloudEmail(username, role);
  const session = await businessCloudAuth(
    signUp ? "signup" : "token?grant_type=password",
    { email, password }
  );
  if (!session.access_token) {
    throw new Error("Cloud account created without an active sign-in. In Supabase, turn off email confirmations and try again.");
  }
  businessCloudStoreSession(session);
  businessCloudConflict = false;
  const record = await businessCloudReadRecord();
  if (record) businessCloudApplyRecord(record);
  else {
    businessCloudSyncedAt = "";
    businessCloudSyncedData = "";
    if (!await businessCloudPush()) {
      throw new Error("Cloud records could not be initialized. Your local records are unchanged; check the cloud connection and try again.");
    }
  }
  businessCloudStatus("Signed in. Business records are syncing across your devices.", "ok");
  return true;
}

async function businessCloudEnsureLocalOwner(username, password) {
  const accounts = readAccounts();
  let account = accounts.find(item => item.role === "admin" && item.username === username);
  if (!account) {
    const salt = accountSalt();
    const signedInAt = new Date().toISOString();
    account = {
      username,
      role: "admin",
      salt: encodeBytes(salt),
      hash: await hashPassword(password, salt),
      createdAt: signedInAt,
      lastLoginAt: signedInAt
    };
    accounts.push(account);
  } else {
    account.lastLoginAt = new Date().toISOString();
  }
  saveAccounts(accounts);
}

businessCloudLoadSession();
const originalBusinessSave = save;
save = function () {
  const result = originalBusinessSave();
  if (result && businessCloudSession && !businessCloudConflict) {
    window.clearTimeout(businessCloudSyncTimer);
    businessCloudSyncTimer = window.setTimeout(businessCloudPush, 900);
  }
  return result;
};

const originalBusinessLogin = login;
login = async function () {
  if (!businessCloudConfigured() || loginRole !== "admin") {
    return originalBusinessLogin();
  }
  const username = normalizeUsername(teamById("username").value);
  const password = teamById("password").value;
  if (!username || !password) return originalBusinessLogin();
  teamById("loginFeedback").textContent = "Signing in and loading your cloud records…";
  teamById("loginSubmit").disabled = true;
  try {
    await businessCloudConnect(username, loginRole, password, false);
    await businessCloudEnsureLocalOwner(username, password);
    if (!load()) throw new Error("Your cloud records could not be loaded.");
    enter(loginRole, username);
    teamById("password").value = "";
  } catch (error) {
    console.error("Unable to sign in to the business cloud.", error);
    businessCloudStatus(error.message, "error");
    teamById("loginFeedback").textContent = error.message || "Cloud sign-in failed.";
    businessCloudSession = null;
    businessCloudSyncedAt = "";
    businessCloudSyncedData = "";
    try { localStorage.removeItem(BUSINESS_CLOUD_SESSION_KEY); }
    catch (storageError) { console.error("Unable to clear failed business cloud sign-in.", storageError); }
  } finally {
    teamById("loginSubmit").disabled = false;
  }
};

const originalBusinessRegister = registerAccount;
registerAccount = async function () {
  if (!businessCloudConfigured() || loginRole !== "admin") {
    return originalBusinessRegister();
  }
  const username = normalizeUsername(teamById("username").value);
  const password = teamById("password").value;
  const confirmation = teamById("confirmPassword").value;
  if (!/^[a-z0-9][a-z0-9 ._-]{1,30}[a-z0-9]$/.test(username) ||
    password.length < 8 || password !== confirmation) {
    return originalBusinessRegister();
  }
  teamById("loginFeedback").textContent = "Creating your cloud account…";
  teamById("registerSubmit").disabled = true;
  try {
    await businessCloudConnect(username, loginRole, password, true);
    await originalBusinessRegister();
    teamById("password").value = "";
    teamById("confirmPassword").value = "";
  } catch (error) {
    console.error("Unable to create a business cloud account.", error);
    businessCloudStatus(error.message, "error");
    teamById("loginFeedback").textContent = error.message || "Cloud account could not be created.";
    businessCloudSession = null;
    businessCloudSyncedAt = "";
    businessCloudSyncedData = "";
    try { localStorage.removeItem(BUSINESS_CLOUD_SESSION_KEY); }
    catch (storageError) { console.error("Unable to clear failed business cloud account.", storageError); }
  } finally {
    teamById("registerSubmit").disabled = false;
  }
};

const originalBusinessReturnToLogin = returnToLogin;
returnToLogin = function () {
  originalBusinessReturnToLogin();
  const session = businessCloudSession;
  businessCloudSession = null;
  businessCloudSyncedAt = "";
  businessCloudSyncedData = "";
  businessCloudConflict = false;
  try { localStorage.removeItem(BUSINESS_CLOUD_SESSION_KEY); }
  catch (error) { console.error("Unable to clear business cloud sign-in.", error); }
  if (session?.access_token && businessCloudConfigured()) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`
      }
    }).catch(error => console.error("Unable to end business cloud sign-in.", error));
  }
};

window.setInterval(async () => {
  if (!currentRole || !businessCloudSession || !navigator.onLine || businessCloudBusy) return;
  if (JSON.stringify(db) !== businessCloudSyncedData) {
    await businessCloudPush();
    return;
  }
  businessCloudBusy = true;
  try {
    const record = await businessCloudReadRecord();
    if (!record || record.updated_at === businessCloudSyncedAt) return;
    if (JSON.stringify(db) !== businessCloudSyncedData) {
      businessCloudConflict = true;
      businessCloudStatus("Cloud data changed on another device while this device also has edits. Your local records are unchanged; back them up before resolving this conflict.", "error");
      return;
    }
    businessCloudApplyRecord(record);
    businessCloudStatus("Updated with the latest records from your cloud account.", "ok");
  } catch (error) {
    console.error("Unable to check for updated business records.", error);
    businessCloudStatus(`Cloud sync check failed: ${error.message}`, "error");
  } finally {
    businessCloudBusy = false;
  }
}, 20000);

window.addEventListener("online", () => {
  if (businessCloudSession) businessCloudPush();
});

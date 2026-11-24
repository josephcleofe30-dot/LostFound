import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  writeBatch,
  onSnapshot,
  collection,
  query,
  where,
  getDocs,
  Timestamp,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ---------- Firebase config: paste yours from Project settings ---------- */
const firebaseConfig = {
  apiKey: "AIzaSyBraPWlI02mB2shk4mBLBUEKzxScylJ9vk",
  authDomain: "lost-and-found-215cc.firebaseapp.com",
  projectId: "lost-and-found-215cc",
  storageBucket: "lost-and-found-215cc.firebasestorage.app",
  messagingSenderId: "378025159518",
  appId: "1:378025159518:web:71964a4c76374fef343dcf",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
let currentUser = null;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const views = {
  loading: $("view-loading"),
  auth: $("view-auth"),
  user: $("view-user"),
  admin: $("view-admin"),
};

function showView(name) {
  Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
}

/* ---------- Theme (persisted in localStorage) ---------- */
function applyTheme(dark) {
  document.body.classList.toggle("dark-mode", dark);
  $("themeIcon").textContent = dark ? "Light" : "Dark";
  $("themeToggle").setAttribute("aria-pressed", String(dark));
}

function loadTheme() {
  let saved = null;
  try { saved = localStorage.getItem("theme"); } catch (_) { /* storage blocked */ }
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved ? saved === "dark" : prefersDark);
}

$("themeToggle").addEventListener("click", () => {
  const dark = !document.body.classList.contains("dark-mode");
  applyTheme(dark);
  try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch (_) { /* ignore */ }
});

loadTheme();

/* ---------- Auth form (sign in / create account) ---------- */
let mode = "login";

function setMode(next) {
  mode = next;
  const isLogin = mode === "login";
  $("authSubmit").textContent = isLogin ? "Sign in" : "Create account";
  $("switchText").textContent = isLogin ? "No account yet?" : "Already have an account?";
  $("switchBtn").textContent = isLogin ? "Create one" : "Sign in";
  $("password").autocomplete = isLogin ? "current-password" : "new-password";
  showAuthError("");
}

function showAuthError(message) {
  const el = $("authError");
  el.textContent = message;
  el.hidden = !message;
}

function friendlyError(err) {
  switch (err.code) {
    case "auth/invalid-email": return "Enter a valid email address.";
    case "auth/missing-password": return "Enter your password.";
    case "auth/weak-password": return "Use a password with at least 6 characters.";
    case "auth/email-already-in-use": return "An account with this email already exists. Sign in instead.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found": return "Email or password is incorrect.";
    case "auth/too-many-requests": return "Too many attempts. Wait a few minutes and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request": return "";
    case "auth/network-request-failed": return "No connection. Check your internet and try again.";
    default: return "Something went wrong. Try again.";
  }
}

$("switchBtn").addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  showAuthError("");
  const email = $("email").value.trim();
  const password = $("password").value;
  $("authSubmit").disabled = true;
  try {
    if (mode === "login") await signInWithEmailAndPassword(auth, email, password);
    else await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    showAuthError(friendlyError(err));
  } finally {
    $("authSubmit").disabled = false;
  }
});

$("googleBtn").addEventListener("click", async () => {
  showAuthError("");
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (err) {
    showAuthError(friendlyError(err));
  }
});

/* ---------- Log out ---------- */
$("logoutBtn").addEventListener("click", () => signOut(auth));

/* ---------- Ban modal ---------- */
function showBanModal() { $("banModal").hidden = false; $("banClose").focus(); }
$("banClose").addEventListener("click", () => { $("banModal").hidden = true; });

/* ---------- User profile doc ---------- */
// Creates users/{uid} on first sign-in. Rules only allow role USER and banned false here.
async function getOrCreateProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const profile = {
    email: user.email,
    role: "USER",
    banned: false,
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, profile);
  return { ...profile };
}

/* ---------- Session routing ---------- */
function setSignedInChrome(user) {
  const signedIn = Boolean(user);
  $("navLinks").hidden = !signedIn;
  $("logoutBtn").hidden = !signedIn;
  $("navUser").textContent = signedIn ? user.email : "";
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser = null;
    stopAdminListeners();
    stopUserListeners();
    setSignedInChrome(null);
    showView("auth");
    return;
  }

  showView("loading");
  try {
    const profile = await getOrCreateProfile(user);

    // Ban check: sign out immediately and explain why
    if (profile.banned === true) {
      await signOut(auth);
      showBanModal();
      return;
    }

    currentUser = user;
    setSignedInChrome(user);
    if (profile.role === "ADMIN") {
      showView("admin");
      startAdminListeners();
    } else {
      showView("user");
      refreshLostLimit();
      startUserListeners();
    }
  } catch (err) {
    console.error("Could not load profile:", err);
    await signOut(auth);
    showAuthError("We couldn't load your account. Check your connection and try again.");
  }
});

/* =====================================================================
   Step 3: user dashboard (found item + lost item forms)
   ===================================================================== */

const DAILY_LIMIT = 3;

/* ---------- Tabs ---------- */
document.querySelectorAll("#view-user .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#view-user .tab").forEach((t) => {
      const active = t === tab;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    });
    ["found", "lost", "activity"].forEach((name) => {
      $("panel-" + name).hidden = tab.dataset.tab !== name;
    });
    if (tab.dataset.tab === "lost") refreshLostLimit();
    updateActivityPill();
  });
});

/* ---------- Helpers ---------- */
function setMsg(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

// datetime-local can't be in the future
function capTimeInputs() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const max = now.toISOString().slice(0, 16);
  $("foundTime").max = max;
  $("lostTime").max = max;
}
capTimeInputs();

// Photos are stored inside the Firestore document as small JPEG data URLs
// (no Cloud Storage). Each photo is shrunk until it is under ~150 KB.
const MAX_PHOTO_CHARS = 200000;

async function photoToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  let side = 640;
  let quality = 0.7;
  let dataUrl = "";
  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    if (dataUrl.length <= MAX_PHOTO_CHARS) break;
    side = Math.round(side * 0.8);
    quality = Math.max(0.4, quality - 0.1);
  }
  bitmap.close?.();
  if (dataUrl.length > MAX_PHOTO_CHARS) throw Object.assign(new Error("photo too large"), { code: "photo-too-large" });
  return dataUrl;
}

async function uploadPhotos(files) {
  return Promise.all(files.map(photoToDataUrl));
}

// Reads the shared fields of either form (prefix is "found" or "lost")
function readFields(prefix) {
  const val = (name) => $(prefix + name).value.trim();
  return {
    contactNumber: val("Contact"),
    itemType: val("Type"),
    brandModel: val("Brand"),
    primaryColor: val("Color"),
    serialNumber: val("Serial"),
    privateMarks: val("Marks"),
    place: val("Location"),
    when: $(prefix + "Time").value,
  };
}

function validateFields(f) {
  if (!/^\+?[\d\s-]{7,20}$/.test(f.contactNumber)) return "Enter a valid contact number.";
  if (!f.itemType) return "Choose an item type.";
  if (!f.primaryColor) return "Choose the primary color.";
  if (!f.place) return "Enter the location.";
  if (!f.when) return "Enter the date and time.";
  if (new Date(f.when) > new Date()) return "The date and time can't be in the future.";
  return "";
}

function uploadErrorMessage(err) {
  if (err?.code === "photo-too-large" || err?.code === "invalid-argument") return "A photo is too large to save. Try again with different photos.";
  if (err?.code === "permission-denied") return "You don't have permission to submit. Check your Firestore rules.";
  if (err?.code === "failed-precondition") return "Firestore needs an index for this query. Open the browser console and click the link in the error.";
  return "Couldn't submit. Check your connection and try again.";
}

/* ---------- Found item form ---------- */
const foundFiles = [null, null, null, null];

document.querySelectorAll("#foundForm .photo-slot input").forEach((input) => {
  input.addEventListener("change", () => {
    const slot = Number(input.dataset.slot);
    const file = input.files[0];
    const label = input.closest(".photo-slot");
    const img = label.querySelector("img");
    if (!file) return;
    foundFiles[slot] = file;
    img.src = URL.createObjectURL(file);
    img.hidden = false;
    label.classList.add("has-photo");
  });
});

$("foundForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("foundError", "");
  setMsg("foundOk", "");
  if (!currentUser) return;

  if (foundFiles.some((f) => !f)) return setMsg("foundError", "Add all 4 photos, one for each angle.");
  const f = readFields("found");
  const problem = validateFields(f);
  if (problem) return setMsg("foundError", problem);

  const btn = $("foundSubmit");
  btn.disabled = true;
  btn.textContent = "Processing photos…";
  try {
    const imageUrls = await uploadPhotos(foundFiles);
    btn.textContent = "Saving…";
    await addDoc(collection(db, "found_items"), {
      userId: currentUser.uid,
      contactNumber: f.contactNumber,
      itemType: f.itemType,
      brandModel: f.brandModel,
      primaryColor: f.primaryColor,
      serialNumber: f.serialNumber,
      privateMarks: f.privateMarks,
      locationFound: f.place,
      timeFound: Timestamp.fromDate(new Date(f.when)),
      imageUrls,
      status: "PENDING",
      createdAt: serverTimestamp(),
    });
    $("foundForm").reset();
    foundFiles.fill(null);
    document.querySelectorAll("#foundForm .photo-slot").forEach((slot) => {
      slot.classList.remove("has-photo");
      const img = slot.querySelector("img");
      img.hidden = true;
      img.removeAttribute("src");
    });
    setMsg("foundOk", "Submitted. An admin will review your report before it is listed.");
  } catch (err) {
    console.error(err);
    setMsg("foundError", uploadErrorMessage(err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Submit found item";
  }
});

/* ---------- Lost item form ---------- */
let lostFiles = [];

$("lostPhotos").addEventListener("change", (e) => {
  const chosen = Array.from(e.target.files);
  setMsg("lostError", "");
  if (chosen.length > 4) setMsg("lostError", "Only the first 4 photos will be used.");
  lostFiles = chosen.slice(0, 4);
  const row = $("lostThumbs");
  row.replaceChildren(...lostFiles.map((file) => {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.alt = "";
    return img;
  }));
});

// Counts this user's requests from the last 24 hours and locks the form at the limit
async function countRecentLostRequests() {
  const since = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
  const q = query(
    collection(db, "lost_requests"),
    where("userId", "==", currentUser.uid),
    where("createdAt", ">=", since),
  );
  const snap = await getDocs(q);
  return snap.size;
}

async function refreshLostLimit() {
  if (!currentUser) return false;
  const note = $("lostLimitNote");
  try {
    const used = await countRecentLostRequests();
    const blocked = used >= DAILY_LIMIT;
    note.classList.toggle("is-blocked", blocked);
    note.textContent = blocked
      ? "You have reached your daily limit of 3 lost item requests today."
      : `${DAILY_LIMIT - used} of ${DAILY_LIMIT} lost item requests left in the last 24 hours.`;
    $("lostSubmit").disabled = blocked;
    return blocked;
  } catch (err) {
    console.error(err);
    note.textContent = uploadErrorMessage(err);
    return false;
  }
}

$("lostForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("lostError", "");
  setMsg("lostOk", "");
  if (!currentUser) return;

  const f = readFields("lost");
  const problem = validateFields(f);
  if (problem) return setMsg("lostError", problem);

  const btn = $("lostSubmit");
  btn.disabled = true;
  btn.textContent = "Checking…";
  try {
    // Re-check right before saving so two tabs can't slip past the limit
    if (await refreshLostLimit()) return;

    btn.disabled = true;
    btn.textContent = lostFiles.length ? "Processing photos…" : "Saving…";
    const imageUrls = lostFiles.length ? await uploadPhotos(lostFiles) : [];
    btn.textContent = "Saving…";
    await addDoc(collection(db, "lost_requests"), {
      userId: currentUser.uid,
      contactNumber: f.contactNumber,
      itemType: f.itemType,
      brandModel: f.brandModel,
      primaryColor: f.primaryColor,
      serialNumber: f.serialNumber,
      privateMarks: f.privateMarks,
      locationLost: f.place,
      timeLost: Timestamp.fromDate(new Date(f.when)),
      imageUrls,
      status: "OPEN",
      createdAt: serverTimestamp(),
    });
    $("lostForm").reset();
    lostFiles = [];
    $("lostThumbs").replaceChildren();
    setMsg("lostOk", "Request sent. Admins can now match it against found items.");
  } catch (err) {
    console.error(err);
    setMsg("lostError", uploadErrorMessage(err));
  } finally {
    btn.textContent = "Send lost item request";
    await refreshLostLimit();
    if ($("lostLimitNote").classList.contains("is-blocked") === false) btn.disabled = false;
  }
});

/* =====================================================================
   Step 4: admin dashboard (approval queue, possible matches, matched)
   ===================================================================== */

let adminUnsubs = [];
let pendingItems = [];
let approvedItems = [];
let matchedItems = [];
let lostRequests = [];

/* ---------- Small DOM helpers (text is always set as text, never HTML) ---------- */
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  kids.flat().forEach((kid) => { if (kid != null) node.append(kid); });
  return node;
}

function fmtTime(ts) {
  return ts && ts.toDate ? ts.toDate().toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "";
}

function detailList(rows) {
  const dl = el("dl", { class: "detail-list" });
  rows.filter(([, value]) => value).forEach(([label, value]) => {
    dl.append(el("dt", { text: label }), el("dd", { text: value }));
  });
  return dl;
}

function photoRow(urls = []) {
  if (!urls.length) return null;
  return el("div", { class: "photo-row" }, urls.map((url) =>
    el("a", {
      href: "#",
      title: "Open full size",
      onclick: async (e) => {
        e.preventDefault();
        const blob = await (await fetch(url)).blob();
        window.open(URL.createObjectURL(blob), "_blank", "noopener");
      },
    }, el("img", { src: url, alt: "Item photo" }))
  ));
}

function newestFirst(a, b) {
  return (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0);
}

async function withBusy(buttons, task) {
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await task();
  } catch (err) {
    console.error(err);
    alert("That didn't work. Check your connection and Firestore rules, then try again.");
    buttons.forEach((b) => { b.disabled = false; });
  }
}

/* ---------- Admin tabs ---------- */
document.querySelectorAll("#view-admin .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#view-admin .tab").forEach((t) => {
      const active = t === tab;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    });
    ["approved", "pending", "matched"].forEach((name) => {
      $("admin-panel-" + name).hidden = tab.dataset.atab !== name;
    });
  });
});

/* ---------- Realtime listeners ---------- */
function startAdminListeners() {
  if (adminUnsubs.length) return;

  const watch = (q, onData, listId) => onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst)),
    (err) => {
      console.error(err);
      $(listId).replaceChildren(el("p", { class: "empty", text: "Couldn't load this list. Check your Firestore rules and connection." }));
    },
  );

  const items = collection(db, "found_items");
  adminUnsubs = [
    watch(query(items, where("status", "==", "PENDING")), (list) => { pendingItems = list; renderPending(); }, "pendingList"),
    watch(query(items, where("status", "==", "APPROVED")), (list) => { approvedItems = list; renderApproved(); }, "approvedList"),
    watch(query(items, where("status", "==", "MATCHED")), (list) => { matchedItems = list; renderMatched(); }, "matchedList"),
    watch(collection(db, "lost_requests"), (list) => { lostRequests = list; renderApproved(); }, "approvedList"),
  ];
}

function stopAdminListeners() {
  adminUnsubs.forEach((unsub) => unsub());
  adminUnsubs = [];
  pendingItems = []; approvedItems = []; matchedItems = []; lostRequests = [];
  closeMatchModal();
}

/* ---------- Pending queue ---------- */
function renderPending() {
  const count = $("pendingCount");
  count.textContent = pendingItems.length;
  count.hidden = pendingItems.length === 0;

  const list = $("pendingList");
  if (!pendingItems.length) {
    list.replaceChildren(el("p", { class: "empty", text: "No found items are waiting for review." }));
    return;
  }

  list.replaceChildren(...pendingItems.map((item) => {
    const approve = el("button", { class: "btn btn-primary btn-small", type: "button", text: "Approve" });
    const reject = el("button", { class: "btn btn-outline btn-small", type: "button", text: "Reject" });
    const ban = el("button", { class: "btn btn-danger btn-small", type: "button", text: "Ban user" });
    const all = [approve, reject, ban];

    approve.addEventListener("click", () => withBusy(all, () => updateDoc(doc(db, "found_items", item.id), { status: "APPROVED" })));
    reject.addEventListener("click", () => withBusy(all, () => updateDoc(doc(db, "found_items", item.id), { status: "REJECTED" })));
    ban.addEventListener("click", () => {
      if (item.userId === currentUser.uid) { alert("You can't ban your own account."); return; }
      if (!confirm("Ban this user? They will be signed out and blocked, and this report will be rejected.")) return;
      withBusy(all, async () => {
        const batch = writeBatch(db);
        batch.update(doc(db, "users", item.userId), { banned: true });
        batch.update(doc(db, "found_items", item.id), { status: "REJECTED" });
        await batch.commit();
      });
    });

    return el("article", { class: "review-card" },
      el("h3", { text: item.itemType }),
      el("p", { class: "muted", text: "Submitted " + fmtTime(item.createdAt) }),
      photoRow(item.imageUrls),
      detailList([
        ["Finder contact", item.contactNumber],
        ["Brand or model", item.brandModel],
        ["Color", item.primaryColor],
        ["Serial or ID", item.serialNumber],
        ["Private marks", item.privateMarks],
        ["Found at", item.locationFound],
        ["Found on", fmtTime(item.timeFound)],
      ]),
      el("div", { class: "actions" }, all),
    );
  }));
}

/* ---------- Approved items (privacy-first cards) ---------- */
const norm = (s) => (s || "").trim().toLowerCase();
const isOpen = (r) => !r.status || r.status === "OPEN";

function matchesFor(item) {
  const hits = lostRequests.filter((r) => isOpen(r) && norm(r.itemType) === norm(item.itemType) && norm(r.primaryColor) === norm(item.primaryColor));
  const score = (r) =>
    (norm(r.serialNumber) && norm(r.serialNumber) === norm(item.serialNumber) ? 2 : 0) +
    (norm(r.brandModel) && norm(r.brandModel) === norm(item.brandModel) ? 1 : 0);
  return hits.sort((a, b) => score(b) - score(a) || newestFirst(a, b));
}

function renderApproved() {
  const list = $("approvedList");
  if (!approvedItems.length) {
    list.replaceChildren(el("p", { class: "empty", text: "No approved found items yet." }));
    return;
  }
  list.replaceChildren(...approvedItems.map((item) => {
    const n = matchesFor(item).length;
    return el("article", { class: "item-card" },
      el("img", { class: "item-thumb", src: item.imageUrls?.[0] || "", alt: item.itemType + " photo", loading: "lazy" }),
      el("div", { class: "item-body" },
        el("h3", { text: item.itemType }),
        el("button", {
          class: "btn btn-primary btn-small",
          type: "button",
          text: `Possible Match (${n})`,
          onclick: () => openMatchModal(item),
        }),
      ),
    );
  }));
}

/* ---------- Possible Match modal ---------- */
function openMatchModal(item) {
  const matches = matchesFor(item);
  const body = $("matchBody");

  const left = el("section", { class: "match-col" },
    el("h3", { text: "Found item" }),
    photoRow(item.imageUrls),
    detailList([
      ["Type", item.itemType],
      ["Color", item.primaryColor],
      ["Brand or model", item.brandModel],
      ["Serial or ID", item.serialNumber],
      ["Private marks", item.privateMarks],
      ["Found at", item.locationFound],
      ["Found on", fmtTime(item.timeFound)],
      ["Finder contact", item.contactNumber],
    ]),
  );

  const right = el("section", { class: "match-col" },
    el("h3", { text: `Lost requests (${matches.length})` }),
    matches.length
      ? el("div", { class: "match-list" }, matches.map((r) => lostCard(item, r)))
      : el("p", { class: "muted", text: "No one has reported a lost " + item.primaryColor.toLowerCase() + " " + item.itemType.toLowerCase() + " yet. This list updates live." }),
  );

  body.replaceChildren(el("div", { class: "match-cols" }, left, right));
  $("matchTitle").textContent = "Possible match";
  $("matchModal").hidden = false;
  $("matchClose").focus();
}

function lostCard(item, req) {
  const serialHit = norm(req.serialNumber) && norm(req.serialNumber) === norm(item.serialNumber);
  const brandHit = norm(req.brandModel) && norm(req.brandModel) === norm(item.brandModel);

  const confirmBtn = el("button", { class: "btn btn-primary btn-small", type: "button", text: "Select as Real Owner & Confirm Match" });
  confirmBtn.addEventListener("click", () => {
    if (!confirm("Confirm this person as the real owner? The item will be marked as matched.")) return;
    withBusy([confirmBtn], async () => {
      const batch = writeBatch(db);
      batch.update(doc(db, "found_items", item.id), {
        status: "MATCHED",
        matchedLostRequestId: req.id,
        matchedAt: serverTimestamp(),
      });
      batch.update(doc(db, "lost_requests", req.id), {
        status: "MATCHED",
        matchedFoundItemId: item.id,
        matchedAt: serverTimestamp(),
      });
      await batch.commit();
      showHandover(item, req);
    });
  });

  return el("article", { class: "lost-card" },
    (serialHit || brandHit) ? el("p", {}, serialHit ? el("span", { class: "badge badge-hit", text: "Serial matches" }) : null, brandHit ? el("span", { class: "badge", text: "Brand matches" }) : null) : null,
    photoRow(req.imageUrls),
    detailList([
      ["Brand or model", req.brandModel],
      ["Serial or ID", req.serialNumber],
      ["Private marks", req.privateMarks],
      ["Lost at", req.locationLost],
      ["Lost on", fmtTime(req.timeLost)],
      ["Requested", fmtTime(req.createdAt)],
    ]),
    el("div", { class: "actions" }, confirmBtn),
  );
}

// Owner contact is only revealed after the match is confirmed
function showHandover(item, req) {
  $("matchTitle").textContent = "Match confirmed";
  $("matchBody").replaceChildren(
    el("div", { class: "handover" },
      el("p", { text: "Contact both people to arrange the handover." }),
      detailList([
        ["Item", `${item.primaryColor} ${item.itemType}`],
        ["Owner contact", req.contactNumber],
        ["Finder contact", item.contactNumber],
        ["Found at", item.locationFound],
      ]),
    ),
  );
}

function closeMatchModal() { $("matchModal").hidden = true; }
$("matchClose").addEventListener("click", closeMatchModal);
$("matchModal").addEventListener("click", (e) => { if (e.target === $("matchModal")) closeMatchModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("matchModal").hidden) closeMatchModal(); });

/* ---------- Matched items ---------- */
function renderMatched() {
  const list = $("matchedList");
  if (!matchedItems.length) {
    list.replaceChildren(el("p", { class: "empty", text: "No confirmed matches waiting for handover." }));
    return;
  }
  list.replaceChildren(...matchedItems.map((item) => {
    const info = el("div");
    const reveal = el("button", { class: "btn btn-outline btn-small", type: "button", text: "Show contacts" });
    const returned = el("button", { class: "btn btn-primary btn-small", type: "button", text: "Mark as returned" });

    reveal.addEventListener("click", () => withBusy([reveal], async () => {
      const snap = await getDoc(doc(db, "lost_requests", item.matchedLostRequestId));
      const owner = snap.exists() ? snap.data().contactNumber : "Request no longer available";
      info.replaceChildren(detailList([["Owner contact", owner], ["Finder contact", item.contactNumber]]));
      reveal.remove();
    }));

    returned.addEventListener("click", () => {
      if (!confirm("Mark this item as returned to its owner? It will leave this list.")) return;
      withBusy([returned, reveal], async () => {
        const batch = writeBatch(db);
        batch.update(doc(db, "found_items", item.id), { status: "RETURNED", returnedAt: serverTimestamp() });
        if (item.matchedLostRequestId) {
          batch.update(doc(db, "lost_requests", item.matchedLostRequestId), { status: "RESOLVED" });
        }
        await batch.commit();
      });
    });

    return el("article", { class: "item-card" },
      el("img", { class: "item-thumb", src: item.imageUrls?.[0] || "", alt: item.itemType + " photo", loading: "lazy" }),
      el("div", { class: "item-body" },
        el("h3", { text: item.itemType }),
        el("p", { class: "muted", text: "Matched " + fmtTime(item.matchedAt) }),
        info,
        reveal,
        returned,
      ),
    );
  }));
}

/* =====================================================================
   My requests (user): status tracking, match notification, mark resolved
   ===================================================================== */

let userUnsubs = [];
let myFound = [];
let myLost = [];

function startUserListeners() {
  if (userUnsubs.length || !currentUser) return;
  const mine = (name, onData, listId) => onSnapshot(
    query(collection(db, name), where("userId", "==", currentUser.uid)),
    (snap) => { onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort(newestFirst)); renderMyActivity(); },
    (err) => {
      console.error(err);
      $(listId).replaceChildren(el("p", { class: "empty", text: "Couldn't load your requests. Check your connection." }));
    },
  );
  userUnsubs = [
    mine("lost_requests", (list) => { myLost = list; }, "myLostList"),
    mine("found_items", (list) => { myFound = list; }, "myFoundList"),
  ];
}

function stopUserListeners() {
  userUnsubs.forEach((unsub) => unsub());
  userUnsubs = [];
  myFound = [];
  myLost = [];
}

// Pill on the tab counts matches the user hasn't looked at yet
function seenMatches() {
  try { return new Set(JSON.parse(localStorage.getItem("seenMatches:" + currentUser.uid) || "[]")); }
  catch (_) { return new Set(); }
}

function updateActivityPill() {
  const pill = $("activityCount");
  if (!currentUser) { pill.hidden = true; return; }
  const matched = myLost.filter((r) => r.status === "MATCHED");
  const seen = seenMatches();
  if (!$("panel-activity").hidden) {
    matched.forEach((r) => seen.add(r.id));
    try { localStorage.setItem("seenMatches:" + currentUser.uid, JSON.stringify([...seen])); } catch (_) { /* ignore */ }
  }
  const unseen = matched.filter((r) => !seen.has(r.id)).length;
  pill.textContent = unseen;
  pill.hidden = unseen === 0;
}

function chip(text, kind) { return el("span", { class: "badge status-" + kind, text }); }

const LOST_STATUS = {
  OPEN: ["Searching", "wait"],
  MATCHED: ["Match found", "good"],
  RESOLVED: ["Resolved", "done"],
};
const FOUND_STATUS = {
  PENDING: ["Waiting for admin review", "wait"],
  APPROVED: ["Approved, admins are looking for the owner", "good"],
  REJECTED: ["Rejected", "bad"],
  MATCHED: ["Owner found, handover being arranged", "good"],
  RETURNED: ["Returned to owner", "done"],
};

function renderMyActivity() {
  updateActivityPill();

  const lostList = $("myLostList");
  lostList.replaceChildren(...(myLost.length ? myLost.map((r) => {
    const [label, kind] = LOST_STATUS[r.status || "OPEN"] || LOST_STATUS.OPEN;
    const card = el("article", { class: "review-card" },
      el("h3", { text: `${r.primaryColor} ${r.itemType}` }),
      chip(label, kind),
      el("p", { class: "muted", text: "Reported " + fmtTime(r.createdAt) }),
      detailList([
        ["Brand or model", r.brandModel],
        ["Lost at", r.locationLost],
        ["Lost on", fmtTime(r.timeLost)],
      ]),
    );
    if (r.status === "MATCHED") {
      card.append(el("div", { class: "handover" },
        el("p", { text: "Good news: an admin found a match for your item." }),
        el("p", { class: "muted", text: `They will contact you at ${r.contactNumber} to arrange the handover.` }),
      ));
    }
    if (!r.status || r.status === "OPEN") {
      const btn = el("button", { class: "btn btn-outline btn-small", type: "button", text: "I found it, close this request" });
      btn.addEventListener("click", () => {
        if (!confirm("Close this request? Admins will stop matching it to found items.")) return;
        withBusy([btn], () => updateDoc(doc(db, "lost_requests", r.id), { status: "RESOLVED" }));
      });
      card.append(el("div", { class: "actions" }, btn));
    }
    return card;
  }) : [el("p", { class: "muted", text: "You haven't sent any lost item requests." })]));

  const foundList = $("myFoundList");
  foundList.replaceChildren(...(myFound.length ? myFound.map((f) => {
    const [label, kind] = FOUND_STATUS[f.status] || ["Unknown", "done"];
    return el("article", { class: "review-card" },
      el("h3", { text: `${f.primaryColor} ${f.itemType}` }),
      chip(label, kind),
      el("p", { class: "muted", text: "Reported " + fmtTime(f.createdAt) }),
      detailList([["Found at", f.locationFound], ["Found on", fmtTime(f.timeFound)]]),
    );
  }) : [el("p", { class: "muted", text: "You haven't reported any found items." })]));
}

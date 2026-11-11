"use strict";
/* ==========================================================
   VIBO — کد اصلی اپ
   همه‌چیز ساده است و کتابخانه‌ی خارجی ندارد.
   بخش‌ها:
     ۱) تنظیمات      ۲) ذخیره‌سازی روی گوشی   ۳) ابزارهای کوچک
     ۴) آیکون‌ها      ۵) قطعه‌های مشترک         ۶) صفحه‌ها
     ۷) رفت‌وآمد بین صفحه‌ها   ۸) رویدادها      ۹) شروع و به‌روزرسانی
   ========================================================== */

/* ---------- ۱) تنظیمات ---------- */
const STORAGE_KEY = "vibo:v1";            // نام جایی که اطلاعات کاربر در گوشی ذخیره می‌شود
const MAX_NICK = 20;                      // بیشترین طول نام مستعار
const DATA_FILES = {                      // فایل‌های محتوا (پوشه‌ی data)
  categories: "./data/categories.json",
  lessons: "./data/lessons.json",
  levels: "./data/levels.json",
  messages: "./data/messages.json"
};

let DB = null;                            // محتوای بارگذاری‌شده
let lessonView = null;                    // درسی که الان باز است: { id, step }
const ui = { query: "", cat: "all", savedTab: "fav" };   // وضعیت جستجو، فیلتر و تب‌ها
const app = document.getElementById("app");

/* ---------- ۲) ذخیره‌سازی روی گوشی (localStorage) ---------- */
/* نکته: این اطلاعات فقط روی همان گوشی می‌ماند و به گوشی دیگر منتقل نمی‌شود. */
function loadState() {
  const base = { nickname: "", nickAsked: false, favs: [], done: [], progress: {} };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === "object") {
        if (typeof s.nickname === "string") base.nickname = s.nickname.slice(0, MAX_NICK);
        base.nickAsked = !!s.nickAsked;
        if (Array.isArray(s.favs)) base.favs = s.favs.filter((x) => typeof x === "string");
        if (Array.isArray(s.done)) base.done = s.done.filter((x) => typeof x === "string");
        if (s.progress && typeof s.progress === "object") base.progress = s.progress;
      }
    }
  } catch (e) { /* اگر ذخیره‌سازی در دسترس نبود، اپ بدون ذخیره کار می‌کند */ }
  return base;
}
let state = loadState();
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* مهم نیست */ }
}

/* ---------- ۳) ابزارهای کوچک ---------- */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fa = (n) => Number(n).toLocaleString("fa-IR");   // عدد فارسی
const faDigits = "۰۱۲۳۴۵۶۷۸۹";
/* یکسان‌سازی متن برای جستجو (ی و ک عربی، نیم‌فاصله، رقم فارسی) */
const norm = (s) => String(s || "").toLowerCase()
  .replace(/ي/g, "ی").replace(/ك/g, "ک")
  .replace(/[‌ً-ٟ]/g, "")
  .replace(/[۰-۹]/g, (d) => faDigits.indexOf(d));

function doneSet() { return new Set(state.done.filter((id) => DB.lessonById.has(id))); }
function totalXp() { let t = 0; doneSet().forEach((id) => { t += DB.lessonById.get(id).xp; }); return t; }

function levelInfo(xp) {
  const L = DB.levels;
  let i = 0;
  L.forEach((l, k) => { if (xp >= l.minXp) i = k; });
  const cur = L[i], next = L[i + 1] || null;
  const pct = next ? Math.round(((xp - cur.minXp) / (next.minXp - cur.minXp)) * 100) : 100;
  return { cur, next, pct, xp };
}

function dayNumber() {                    // شماره‌ی روز (برای درس روز و پیام‌ها)
  const d = new Date();
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}
function pickMsg(type, salt = 0) {
  const list = DB.messages.filter((m) => m.type === type);
  return list.length ? list[(dayNumber() + salt) % list.length].text : "";
}
function randomMsg(type) {
  const list = DB.messages.filter((m) => m.type === type);
  return list.length ? list[Math.floor(Math.random() * list.length)].text : "";
}
const dailyLesson = () => DB.lessons[dayNumber() % DB.lessons.length];

function inProgress() {                   // درس‌های نیمه‌تمام (جدیدترین اول)
  return Object.entries(state.progress)
    .map(([id, p]) => ({ l: DB.lessonById.get(id), p }))
    .filter((x) => x.l && x.p && x.p.step >= 1 && !state.done.includes(x.l.id))
    .sort((a, b) => (b.p.t || 0) - (a.p.t || 0));
}

/* پیشنهاد درس بر اساس قواعد ساده‌ی داخل گوشی (هوش مصنوعی واقعی نیست) */
function suggestions(excludeIds) {
  const done = doneSet();
  const lastDoneId = state.done.filter((id) => DB.lessonById.has(id)).slice(-1)[0];
  const lastDone = lastDoneId ? DB.lessonById.get(lastDoneId) : null;
  const favCats = new Set(state.favs.map((id) => DB.lessonById.get(id)).filter(Boolean).map((l) => l.categoryId));
  const list = DB.lessons.filter((l) => !done.has(l.id) && !excludeIds.has(l.id)).map((l) => {
    let score = 0, reason = "برای گسترش مهارتت";
    if (lastDone && l.order === lastDone.order + 1) { score = 3; reason = "چون درس قبلی را تمام کردی"; }
    else if (lastDone && l.categoryId === lastDone.categoryId) { score = 2; reason = "هم‌موضوع با درسی که خواندی"; }
    else if (favCats.has(l.categoryId)) { score = 2; reason = "از موضوع موردعلاقه‌ات"; }
    else if (l.level === "مبتدی") { score = 1; reason = "برای شروع مناسب است"; }
    return { l, score, reason };
  });
  list.sort((a, b) => b.score - a.score || a.l.order - b.l.order);
  return list.slice(0, 3);
}

/* ---------- ۴) آیکون‌ها (دو‌رنگ و خطی، همه داخل خود اپ) ---------- */
const ICONS = {
  home: ["M3.5 11.2 12 4l8.5 7.2V19a1.5 1.5 0 0 1-1.5 1.5h-4v-5.5H9v5.5H5A1.5 1.5 0 0 1 3.5 19z", 1],
  book: ["M12 6.6C10.1 5.2 7.6 4.6 4 4.6v12.8c3.6 0 6.1.6 8 2 1.9-1.4 4.4-2 8-2V4.6c-3.6 0-6.1.6-8 2zM12 6.6v12.8", 1],
  heart: ["M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z", 1],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c0-3.6 3.4-5.5 7.5-5.5s7.5 1.9 7.5 5.5z", 1],
  sliders: ["M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5", 0],
  search: ["M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM16 16l4.5 4.5", 0],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2", 0],
  star: ["M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.2-4.1 5.8-.8z", 1],
  check: ["M5 12.5l4.5 4.5L19 7.5", 0],
  bolt: ["M13 3 5.5 13.5H11L10 21l7.5-10.5H12z", 1],
  left: ["M14.5 6 8.5 12l6 6", 0],
  right: ["M9.5 6l6 6-6 6", 0]
};
function ico(name) {
  const it = ICONS[name];
  if (!it) return "";
  return `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${it[0]}"${it[1] ? ' class="fill"' : ""}/></svg>`;
}

/* ---------- ۵) قطعه‌های مشترک ---------- */
function metaLine(l) {
  return `<span class="meta"><span class="m">${ico("clock")}${fa(l.minutes)} دقیقه</span><span class="m">${esc(l.level)}</span><span class="m">${ico("bolt")}${fa(l.xp)} امتیاز</span></span>`;
}
function favBtn(id) {
  const on = state.favs.includes(id);
  return `<button type="button" class="fav" data-fav="${esc(id)}" aria-pressed="${on}" aria-label="${on ? "حذف از موردعلاقه‌ها" : "افزودن به موردعلاقه‌ها"}">${ico("heart")}</button>`;
}
function thumb(l, size) {
  const c = DB.catById.get(l.categoryId);
  return c ? `<img src="${esc(c.image)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">` : "";
}
function progressBar(pct, small) {
  return `<div class="bar${small ? " sm" : ""}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="--w:${pct}%"></i></div>`;
}
function lessonRow(l, opts = {}) {
  const { reason = "", i = 0, prog = null } = opts;
  const done = state.done.includes(l.id);
  let extra = "";
  if (prog) {
    const pct = Math.round((prog.step / l.steps.length) * 100);
    extra = progressBar(pct, true) + `<p class="muted">مرحله‌ی ${fa(Math.min(prog.step + 1, l.steps.length))} از ${fa(l.steps.length)}</p>`;
  } else if (reason) {
    extra = `<p class="reason">${ico("star")}${esc(reason)}</p>`;
  }
  return `<article class="card lrow reveal" style="--i:${i}">
    <a class="lrow-link" href="#/lesson/${esc(l.id)}">${thumb(l, 84)}
      <div class="lrow-body"><h3>${esc(l.title)}</h3><span class="sum">${esc(l.summary)}</span>${metaLine(l)}${done ? `<span class="badge-done">${ico("check")}خوانده‌شده</span>` : ""}${extra}</div>
    </a>${favBtn(l.id)}</article>`;
}
function levelBlock(lv, xp) {
  const nextTxt = lv.next ? `${fa(lv.next.minXp - xp)} امتیاز تا «${esc(lv.next.title)}»` : "به بالاترین سطح رسیدی";
  return `<div class="level-row"><span class="chip-level">${ico("star")}سطح ${fa(lv.cur.level)} · ${esc(lv.cur.title)}</span><span class="xp">${fa(xp)} امتیاز</span></div>
    ${progressBar(lv.pct, false)}<p class="muted">${nextTxt}</p>`;
}
function nickForm(idSuffix) {
  return `<form class="nick-form" data-nick-form>
    <label for="nick-${idSuffix}">اسمت چیست؟ (اختیاری)</label>
    <div class="nick-row"><input id="nick-${idSuffix}" name="nick" type="text" maxlength="${MAX_NICK}" autocomplete="off" value="${esc(state.nickname)}" placeholder="مثلاً: سارا"><button class="btn btn-ghost" type="submit">ذخیره</button></div>
  </form>`;
}
function emptyState(msg, btnText, href) {
  return `<div class="card empty reveal">${ico("book")}<p>${msg}</p><a class="btn btn-primary" href="${href}">${btnText}</a></div>`;
}

/* ---------- ۶) صفحه‌ها ---------- */
function viewHome() {
  const done = doneSet(), xp = totalXp(), lv = levelInfo(xp);
  const prog = inProgress();
  const isNew = done.size === 0 && prog.length === 0;
  const name = state.nickname.trim();
  const daily = dailyLesson();
  const dailyDone = done.has(daily.id);
  let i = 0;

  /* خوشامدگویی */
  const hello = name ? `خوش آمدی، ${esc(name)}!` : "به VIBO خوش آمدی!";
  let welcomeBody;
  if (isNew) {
    welcomeBody = `<h1>${hello}</h1><p class="lead">${esc(pickMsg("newUser"))}</p>
      ${state.nickAsked ? "" : nickForm("home") + `<button type="button" class="nick-skip" data-act="skip-nick">فعلاً نه، رد کردن</button>`}
      <a class="btn btn-primary btn-block" href="#/lesson/${esc(DB.lessons[0].id)}">شروع اولین درس</a>`;
  } else {
    welcomeBody = `<h1>${hello}</h1><p class="lead">${esc(pickMsg("welcome"))}</p>${levelBlock(lv, xp)}<p class="quote">«${esc(pickMsg("encourage", 1))}»</p>`;
  }

  /* ادامه‌ی یادگیری (فقط اگر درس نیمه‌تمام داشته باشد) */
  let cont = "";
  if (prog.length) {
    cont = `<section aria-labelledby="cont-h"><div class="sec-head"><h2 id="cont-h">ادامه یادگیری</h2></div><div class="stack">` +
      prog.slice(0, 3).map((x, k) => lessonRow(x.l, { prog: x.p, i: k })).join("") + `</div></section>`;
  }

  /* پیشنهادها */
  const exclude = new Set([daily.id, ...prog.map((x) => x.l.id)]);
  const sug = suggestions(exclude);
  let sugHtml;
  if (sug.length) sugHtml = `<div class="stack">` + sug.map((s, k) => lessonRow(s.l, { reason: s.reason, i: k })).join("") + `</div>`;
  else sugHtml = `<div class="card muted reveal">همه‌ی درس‌های فعلی را خوانده‌ای. آفرین! به‌زودی درس‌های تازه می‌رسد.</div>`;

  /* دسته‌بندی‌ها */
  const cats = DB.categories.map((c, k) => {
    const n = DB.lessons.filter((l) => l.categoryId === c.id).length;
    return `<a class="cat reveal" style="--i:${k}" href="#/lessons" data-cat="${esc(c.id)}"><img src="${esc(c.image)}" alt="" width="360" height="360" loading="lazy" decoding="async"><span class="cat-name">${esc(c.title)}</span><span class="cat-count">${fa(n)} درس</span></a>`;
  }).join("");

  return `
    <form class="search reveal" role="search" data-search-home>
      ${ico("search")}<input type="search" name="q" placeholder="جستجو در VIBO..." aria-label="جستجو در VIBO" autocomplete="off" enterkeyhint="search">
      <button class="sr-only" type="submit">جستجو</button>
    </form>

    <section class="card welcome reveal" style="--i:${++i}" aria-label="خوشامدگویی">
      <img class="welcome-img" src="./images/vibo/welcome.jpg" alt="ربات VIBO دست تکان می‌دهد و سلام می‌کند" width="1000" height="480" decoding="async">
      <div class="welcome-body">${welcomeBody}</div>
    </section>

    <section class="reveal" style="--i:${++i}" aria-labelledby="daily-h">
      <div class="card daily">
        <span class="pill">${ico("star")}درس روز</span>
        <div class="daily-main">${thumb(daily, 128)}
          <div><h2 id="daily-h">${esc(daily.title)}</h2><span class="sum">${esc(daily.summary)}</span>${metaLine(daily)}</div>
        </div>
        <a class="btn btn-primary btn-block" href="#/lesson/${esc(daily.id)}">${dailyDone ? "مرور دوباره‌ی درس" : "شروع درس"}</a>
      </div>
    </section>

    ${cont}

    <section aria-labelledby="cats-h">
      <div class="sec-head"><h2 id="cats-h">موضوعات</h2><a class="link" href="#/lessons" data-cat="all">مشاهده همه ${ico("left")}</a></div>
      <div class="cats">${cats}</div>
    </section>

    <section aria-labelledby="sug-h">
      <div class="sec-head"><h2 id="sug-h">درس‌های پیشنهادی</h2></div>
      ${sugHtml}
    </section>`;
}

function filterLessons() {
  const q = norm(ui.query).trim();
  return DB.lessons.filter((l) => {
    if (ui.cat !== "all" && l.categoryId !== ui.cat) return false;
    if (!q) return true;
    const c = DB.catById.get(l.categoryId);
    return norm([l.title, l.summary, (l.tags || []).join(" "), c ? c.title : ""].join(" ")).includes(q);
  });
}
function viewLessons() {
  const chips = [`<button type="button" class="chip" data-cat-filter="all" aria-pressed="${ui.cat === "all"}">همه</button>`]
    .concat(DB.categories.map((c) => `<button type="button" class="chip" data-cat-filter="${esc(c.id)}" aria-pressed="${ui.cat === c.id}">${esc(c.title)}</button>`)).join("");
  return `
    <h1 class="reveal">درس‌ها</h1>
    <form class="search reveal" role="search" data-search-lessons style="--i:1">
      ${ico("search")}<input type="search" name="q" value="${esc(ui.query)}" placeholder="جستجو در درس‌ها..." aria-label="جستجو در درس‌ها" autocomplete="off" enterkeyhint="search">
      <button class="sr-only" type="submit">جستجو</button>
    </form>
    <div class="chips" role="group" aria-label="فیلتر موضوع">${chips}</div>
    <p class="count" id="count" aria-live="polite"></p>
    <div id="list" class="stack"></div>`;
}
function updateLessonList() {
  const list = document.getElementById("list"), count = document.getElementById("count");
  if (!list) return;
  const items = filterLessons();
  count.textContent = `${fa(items.length)} درس`;
  list.innerHTML = items.length
    ? items.map((l, k) => lessonRow(l, { i: Math.min(k, 6) })).join("")
    : `<div class="card empty">${ico("search")}<p>درسی پیدا نشد. عبارت دیگری را امتحان کن یا فیلتر را بردار.</p><button type="button" class="btn btn-ghost" data-act="clear-search">پاک‌کردن جستجو و فیلتر</button></div>`;
}

/* ---- صفحه‌ی خود درس: چند مرحله + صفحه‌ی نکته‌ی کلیدی ---- */
function viewLesson(id) {
  const l = DB.lessonById.get(id);
  if (!l) return viewNotFound();
  const p = state.progress[id];
  const total = l.steps.length;
  const step = p && !state.done.includes(id) ? Math.min(Math.max(p.step | 0, 0), total) : 0;
  lessonView = { id, step };
  return lessonStepHtml();
}
function lessonStepHtml() {
  const l = DB.lessonById.get(lessonView.id), total = l.steps.length, step = lessonView.step;
  const isDone = state.done.includes(l.id);
  const pct = Math.round((step / total) * 100);
  const head = `<div class="lesson-head"><a class="back" href="#/lessons">${ico("right")}بازگشت</a>${favBtn(l.id)}</div>
    <div><h1>${esc(l.title)}</h1>${metaLine(l)}</div>
    <div>${progressBar(pct, false)}<p class="stepno">${step < total ? `مرحله‌ی ${fa(step + 1)} از ${fa(total)}` : "نکته‌ی پایانی"}</p></div>`;
  let body, nav;
  if (step < total) {
    const s = l.steps[step];
    body = `<article class="card step"><h2>${esc(s.title)}</h2><p>${esc(s.text)}</p></article>`;
    nav = `<div class="btn-row">${step > 0 ? `<button type="button" class="btn btn-ghost" data-act="prev">قبلی</button>` : ""}<button type="button" class="btn btn-primary" data-act="next">${step === total - 1 ? "نکته‌ی پایانی" : "بعدی"}</button></div>`;
  } else {
    body = `<article class="card step takeaway"><span class="tag">نکته‌ی کلیدی</span><p>${esc(l.keyTakeaway || "")}</p>${isDone ? `<p class="muted">این درس را قبلاً خوانده‌ای و امتیازش را گرفته‌ای.</p>` : ""}</article>`;
    nav = `<div class="btn-row"><button type="button" class="btn btn-ghost" data-act="prev">قبلی</button><button type="button" class="btn btn-primary" data-act="finish">${isDone ? "تمام شد" : `تمام کردم · ${fa(l.xp)} امتیاز`}</button></div>`;
  }
  return head + body + nav;
}
function renderLessonStep() { mount(lessonStepHtml(), { fade: false }); }
function goStep(delta) {
  if (!lessonView) return;
  const l = DB.lessonById.get(lessonView.id);
  lessonView.step = Math.min(Math.max(lessonView.step + delta, 0), l.steps.length);
  if (!state.done.includes(l.id) && lessonView.step >= 1) { state.progress[l.id] = { step: lessonView.step, t: Date.now() }; saveState(); }
  renderLessonStep();
}
function finishLesson() {
  const l = DB.lessonById.get(lessonView.id);
  const before = levelInfo(totalXp()).cur.level;
  const first = !state.done.includes(l.id);
  if (first) state.done.push(l.id);
  delete state.progress[l.id];
  saveState();
  const after = levelInfo(totalXp()).cur;
  const done = doneSet();
  const next = DB.lessons.find((x) => x.order > l.order && !done.has(x.id)) || DB.lessons.find((x) => !done.has(x.id));
  mount(`
    <section class="card done-view">
      <img src="./images/vibo/done.jpg" alt="ربات VIBO با شست بالا، تیک سبز و جام" width="623" height="643">
      <h1>آفرین!</h1>
      <p>${esc(randomMsg("lessonDone"))}</p>
      ${first ? `<span class="xp-chip">${ico("bolt")}${fa(l.xp)} امتیاز گرفتی</span>` : `<p class="muted">این درس را قبلاً تمام کرده بودی.</p>`}
      ${after.level > before ? `<p class="levelup">به سطح ${fa(after.level)} رسیدی: ${esc(after.title)}</p>` : ""}
      <div class="btn-row">
        ${next ? `<a class="btn btn-primary" href="#/lesson/${esc(next.id)}">درس بعدی</a>` : ""}
        <a class="btn btn-ghost" href="#/">صفحه‌ی اصلی</a>
      </div>
    </section>`);
}

/* ---- ذخیره‌شده‌ها و پیشرفت ---- */
function viewSaved() {
  const done = doneSet();
  const favs = DB.lessons.filter((l) => state.favs.includes(l.id));
  const doneList = DB.lessons.filter((l) => done.has(l.id));
  const pct = Math.round((done.size / DB.lessons.length) * 100);
  const showFav = ui.savedTab === "fav";
  const items = showFav ? favs : doneList;
  const list = items.length
    ? `<div class="stack">${items.map((l, k) => lessonRow(l, { i: Math.min(k, 6) })).join("")}</div>`
    : emptyState(showFav ? "هنوز درسی را به موردعلاقه‌ها اضافه نکرده‌ای. روی قلب کنار هر درس بزن." : "هنوز درسی را تمام نکرده‌ای. با یک درس کوتاه شروع کن!", "رفتن به درس‌ها", "#/lessons");
  return `
    <h1 class="reveal">ذخیره‌شده‌ها و پیشرفت</h1>
    <section class="card reveal" style="--i:1" aria-label="پیشرفت من">
      <div class="level-row"><b>پیشرفت من</b><span class="xp">${fa(done.size)} از ${fa(DB.lessons.length)} درس</span></div>
      ${progressBar(pct, false)}
    </section>
    <div class="tabs reveal" style="--i:2" role="tablist">
      <button type="button" class="tab" role="tab" data-tab="fav" aria-selected="${showFav}">موردعلاقه‌ها (${fa(favs.length)})</button>
      <button type="button" class="tab" role="tab" data-tab="done" aria-selected="${!showFav}">خوانده‌شده‌ها (${fa(doneList.length)})</button>
    </div>
    ${list}`;
}

/* ---- پروفایل ---- */
function viewProfile() {
  const done = doneSet(), xp = totalXp(), lv = levelInfo(xp);
  return `
    <h1 class="reveal">پروفایل</h1>
    <section class="card reveal" style="--i:1">
      <div class="profile-top"><img src="./icons/icon-192.png" alt="" width="72" height="72"><div><h2>${state.nickname.trim() ? esc(state.nickname) : "یادگیرنده‌ی VIBO"}</h2><p class="muted">سطح ${fa(lv.cur.level)} · ${esc(lv.cur.title)}</p></div></div>
    </section>
    <section class="card reveal" style="--i:2">${nickForm("profile")}<p class="note-ok" id="nick-msg" role="status"></p></section>
    <section class="card reveal" style="--i:3" aria-label="سطح و امتیاز">${levelBlock(lv, xp)}</section>
    <section class="stats reveal" style="--i:4" aria-label="آمار">
      <div class="stat"><b>${fa(done.size)}</b><span>درس خوانده‌شده</span></div>
      <div class="stat"><b>${fa(xp)}</b><span>امتیاز</span></div>
      <div class="stat"><b>${fa(state.favs.filter((id) => DB.lessonById.has(id)).length)}</b><span>موردعلاقه</span></div>
    </section>
    <section class="card about reveal" style="--i:5">
      <h2>درباره‌ی VIBO</h2>
      <p>VIBO یک اپ فارسی برای یادگیری ساده‌ی هوش مصنوعی است؛ از صفر و با درس‌های کوتاه چند دقیقه‌ای.</p>
      <p class="muted">همه‌ی اطلاعات شما (نام، موردعلاقه‌ها و پیشرفت) فقط روی همین گوشی ذخیره می‌شود و جایی ارسال نمی‌شود. درس‌ها بدون اینترنت هم باز می‌شوند.</p>
      <p class="conn" id="conn" aria-live="polite">${navigator.onLine ? "اتصال: آنلاین" : "اتصال: آفلاین (درس‌ها همچنان کار می‌کنند)"}</p>
    </section>
    <button type="button" class="btn btn-danger btn-block" data-act="reset">پاک‌کردن پیشرفت و موردعلاقه‌ها</button>`;
}

function viewNotFound() {
  return emptyState("این صفحه پیدا نشد.", "رفتن به صفحه‌ی اصلی", "#/");
}
function viewError() {
  return `<div class="card empty">${ico("book")}<p>محتوا بارگذاری نشد. اگر اینترنت قطع است، یک بار با اینترنت اپ را باز کن؛ بعد از آن آفلاین هم کار می‌کند.</p><button type="button" class="btn btn-primary" data-act="retry">تلاش دوباره</button></div>`;
}

/* ---------- ۷) رفت‌وآمد بین صفحه‌ها ---------- */
function mount(html, opts = {}) {
  const { scroll = true, fade = true } = opts;
  app.innerHTML = html;
  if (fade) { app.classList.remove("view"); void app.offsetWidth; app.classList.add("view"); }
  if (scroll) { window.scrollTo(0, 0); app.focus({ preventScroll: true }); }
}
function setNav(name) {
  document.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === name) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
}
function route(opts = {}) {
  if (!DB) return;
  const parts = (location.hash.replace(/^#/, "") || "/").split("/").filter(Boolean);
  let html, nav = "home", title = "";
  lessonView = null;
  if (!parts.length) { html = viewHome(); }
  else if (parts[0] === "lessons") { html = viewLessons(); nav = "lessons"; title = "درس‌ها"; }
  else if (parts[0] === "lesson" && parts[1]) {
    html = viewLesson(decodeURIComponent(parts[1])); nav = "lessons";
    const l = DB.lessonById.get(decodeURIComponent(parts[1])); title = l ? l.title : "";
  }
  else if (parts[0] === "saved") { html = viewSaved(); nav = "saved"; title = "ذخیره‌شده‌ها"; }
  else if (parts[0] === "profile") { html = viewProfile(); nav = "profile"; title = "پروفایل"; }
  else { html = viewNotFound(); }
  document.title = title ? `${title} | VIBO` : "VIBO | یادگیری هوش مصنوعی";
  setNav(nav);
  mount(html, opts);
  if (parts[0] === "lessons") updateLessonList();
}

/* ---------- ۸) رویدادها ---------- */
function toggleFav(id) {
  const i = state.favs.indexOf(id);
  if (i >= 0) state.favs.splice(i, 1); else state.favs.push(id);
  saveState();
  const on = state.favs.includes(id);
  document.querySelectorAll(`[data-fav="${CSS.escape(id)}"]`).forEach((b) => {
    b.setAttribute("aria-pressed", on);
    b.setAttribute("aria-label", on ? "حذف از موردعلاقه‌ها" : "افزودن به موردعلاقه‌ها");
  });
  if (location.hash.startsWith("#/saved")) route({ scroll: false, fade: false });
}

document.addEventListener("click", (e) => {
  const t = e.target;
  const fav = t.closest("[data-fav]");
  if (fav) { toggleFav(fav.dataset.fav); return; }

  const cat = t.closest("[data-cat]");
  if (cat) { ui.cat = cat.dataset.cat; ui.query = ""; return; }   // پیوند خودش به #/lessons می‌رود

  const chip = t.closest("[data-cat-filter]");
  if (chip) {
    ui.cat = chip.dataset.catFilter;
    document.querySelectorAll("[data-cat-filter]").forEach((c) => c.setAttribute("aria-pressed", c.dataset.catFilter === ui.cat));
    updateLessonList();
    return;
  }

  const tab = t.closest("[data-tab]");
  if (tab) { ui.savedTab = tab.dataset.tab; route({ scroll: false, fade: false }); return; }

  const act = t.closest("[data-act]");
  if (!act) return;
  switch (act.dataset.act) {
    case "next": goStep(1); break;
    case "prev": goStep(-1); break;
    case "finish": finishLesson(); break;
    case "skip-nick": state.nickAsked = true; saveState(); route({ scroll: false, fade: false }); break;
    case "clear-search": ui.query = ""; ui.cat = "all"; route({ scroll: false, fade: false }); break;
    case "retry": init(); break;
    case "reset":
      if (confirm("همه‌ی پیشرفت و موردعلاقه‌های این گوشی پاک شود؟ این کار برگشت‌پذیر نیست.")) {
        state.favs = []; state.done = []; state.progress = {}; saveState(); route({ scroll: false, fade: false });
      }
      break;
  }
});

document.addEventListener("submit", (e) => {
  const f = e.target;
  if (f.matches("[data-search-home]")) {
    e.preventDefault();
    ui.query = (new FormData(f).get("q") || "").toString().trim(); ui.cat = "all";
    location.hash = "#/lessons";
  } else if (f.matches("[data-search-lessons]")) {
    e.preventDefault();
    document.activeElement && document.activeElement.blur();
  } else if (f.matches("[data-nick-form]")) {
    e.preventDefault();
    state.nickname = (new FormData(f).get("nick") || "").toString().trim().slice(0, MAX_NICK);
    state.nickAsked = true; saveState();
    if (location.hash.startsWith("#/profile")) {
      route({ scroll: false, fade: false });
      const m = document.getElementById("nick-msg"); if (m) m.textContent = "ذخیره شد.";
    } else route({ scroll: false, fade: false });
  }
});

document.addEventListener("input", (e) => {
  if (e.target.closest("[data-search-lessons]")) { ui.query = e.target.value; updateLessonList(); }
});

window.addEventListener("hashchange", () => route());
window.addEventListener("online", updateConn);
window.addEventListener("offline", updateConn);
function updateConn() {
  const c = document.getElementById("conn");
  if (c) c.textContent = navigator.onLine ? "اتصال: آنلاین" : "اتصال: آفلاین (درس‌ها همچنان کار می‌کنند)";
}

/* ---------- ۹) شروع برنامه و به‌روزرسانی ---------- */
async function loadData() {
  const entries = await Promise.all(Object.entries(DATA_FILES).map(async ([k, url]) => {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error("خطا در " + url);
    return [k, await r.json()];
  }));
  const d = Object.fromEntries(entries);
  d.lessons.sort((a, b) => a.order - b.order);
  d.categories.sort((a, b) => a.order - b.order);
  d.levels.sort((a, b) => a.minXp - b.minXp);
  d.lessonById = new Map(d.lessons.map((l) => [l.id, l]));
  d.catById = new Map(d.categories.map((c) => [c.id, c]));
  return d;
}

function buildChrome() {                  // آیکون‌های هدر و نوار پایین
  document.querySelectorAll("[data-ico]").forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
}

function showUpdateBar(worker) {
  const bar = document.getElementById("update-bar"), btn = document.getElementById("update-btn");
  bar.hidden = false;
  btn.onclick = () => { btn.disabled = true; worker.postMessage({ type: "SKIP_WAITING" }); };
}
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloading) return;
    reloading = true; location.reload();
  });
  navigator.serviceWorker.register("./service-worker.js").then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      if (!nw) return;
      nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateBar(nw);
      });
    });
    /* هر بار که کاربر دوباره به اپ برمی‌گردد، دنبال نسخه‌ی جدید بگرد */
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => { /* اگر ثبت نشد (مثلاً آدرس امن نیست)، اپ بدون آفلاین کار می‌کند */ });
}

async function init() {
  try {
    DB = await loadData();
  } catch (err) {
    DB = null;
    mount(viewError());
    return;
  }
  route();
}

buildChrome();
registerSW();
init();

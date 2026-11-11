/* VIBO — service worker
   کار این فایل: آفلاین کار کردن اپ و رساندن نسخه‌ی جدید به کسانی که اپ را نصب کرده‌اند. */

/* ⚠️ هر بار که محتوا، عکس یا کدی را عوض کردی و دوباره منتشر کردی،
   این عدد را یکی بالا ببر (مثلاً v2 ، v3 ، v4 ...) تا گوشی‌ها نسخه‌ی جدید را بگیرند. */
const CACHE_VERSION = "v1";

const CACHE_NAME = "vibo-" + CACHE_VERSION;

/* فایل‌هایی که برای کار کردن آفلاین ذخیره می‌شوند.
   اگر فایل تازه‌ای به پروژه اضافه کردی (مثلاً عکس جدید)، آدرسش را اینجا هم بنویس. */
const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./data/categories.json",
  "./data/lessons.json",
  "./data/levels.json",
  "./data/messages.json",
  "./fonts/Vazir-Bold.woff",
  "./fonts/Vazir-Light.woff",
  "./fonts/Vazir-Medium.woff",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./images/vibo/cheer.jpg",
  "./images/vibo/done.jpg",
  "./images/vibo/welcome.jpg",
  "./images/categories/ai-tools.jpg",
  "./images/categories/beginners.jpg",
  "./images/categories/business.jpg",
  "./images/categories/content.jpg",
  "./images/categories/creativity.jpg",
  "./images/categories/education.jpg",
  "./images/categories/home-life.jpg",
  "./images/categories/programming.jpg"
];

/* نصب: همه‌ی فایل‌ها را در حافظه‌ی گوشی ذخیره کن */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" }))))
    )
  );
});

/* فعال‌شدن: حافظه‌های قدیمی را پاک کن */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("vibo-") && k !== CACHE_NAME).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* وقتی کاربر دکمه‌ی «به‌روزرسانی» را زد */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* درخواست‌ها */
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/data/")) {
    /* فایل‌های محتوا: اول اینترنت (برای دیدن محتوای تازه)، اگر نبود حافظه */
    event.respondWith(networkFirst(req));
  } else {
    /* بقیه‌ی فایل‌ها: اول حافظه (سریع و آفلاین) */
    event.respondWith(cacheFirst(req));
  }
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await withTimeout(fetch(req, { cache: "no-cache" }), 4000);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    if (req.mode === "navigate") {
      const page = await cache.match("./index.html");
      if (page) return page;
    }
    throw err;
  }
}

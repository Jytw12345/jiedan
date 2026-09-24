/* 询单登记 Service Worker
 * - 预缓存应用外壳；导航与静态资源一律「缓存优先」（安卓冷启动零网络等待，秒开）
 * - 缓存名含构建时间戳（构建脚本自动注入），每次发版自动检测并接管
 * - Supabase 等跨域 API 请求一律直连网络，不做缓存
 * 发版链路：sw.js 内容每次构建必变 → 浏览器 update 检测到新 SW → install 阶段重新预缓存
 * 新外壳 → skipWaiting 接管 → 页面自动刷新 → 加载新 hash 资源（miss 时走网络并回填缓存）
 */
const CACHE = 'xundan-' + '1790244975154'
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})

// 网络失败时统一回退到缓存外壳（至少能进首屏），仍不行才返回离线提示
function fallbackShell() {
  return caches.match('./index.html').then(
    (r) =>
      r ||
      new Response('离线，请联网后重试', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }),
  )
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // 只处理同源 GET；跨域（Supabase 等 API）一律直连网络，不做缓存
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // 导航请求（打开页面 / 刷新）：缓存优先——已安装 PWA 冷启动不再等跨境网络。
  // 缓存 miss（首次访问）才走网络并写回缓存。
  if (e.request.mode === 'navigate') {
    e.respondWith(
      caches.match('./index.html').then((r) => r || fetch(e.request).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
        }
        return res
      }).catch(fallbackShell)),
    )
    return
  }

  // 静态子资源（JS/CSS/图片/字体）：文件名含 hash、内容不可变 → 缓存命中即正确，缓存优先。
  // miss 才走网络（成功写回缓存）；旧版本 hash 文件被删等异常回退外壳，避免裂图卡屏。
  e.respondWith(
    caches.match(e.request).then(
      (r) =>
        r ||
        fetch(e.request).then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
            return res
          }
          return fallbackShell()
        }, fallbackShell),
    ),
  )
})

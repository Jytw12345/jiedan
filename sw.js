/* 询单登记 Service Worker
 * - 预缓存应用外壳，静态资源网络优先、离线回退
 * - 缓存名含构建时间戳（构建脚本自动注入），每次发版自动检测并接管
 * - Supabase 等跨域 API 请求一律直连网络，不做缓存
 */
const CACHE = 'xundan-' + '1790208546832'
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

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // 只处理同源 GET；跨域（Supabase 等 API）一律直连网络，不做缓存
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // 导航请求（打开页面 / 刷新）：网络优先，但「服务器返回 404/5xx」也要回退缓存外壳。
  // 否则部署窗口期（新 index.html 已上线、旧 hash 资源被删）或旧 SW 仍引用已被删除的旧
  // hash 资源时，会把 404 当成功直接返回，React 永远挂载不上 → 永久卡在启动页（#root 静态占位）。
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
            return res
          }
          // 非 2xx：回退到缓存中的应用外壳，至少能进首屏，不再永久卡屏
          return caches.match('./index.html').then((r) => r || res)
        })
        .catch(() =>
          caches.match('./index.html').then(
            (r) =>
              r ||
              new Response('离线，请联网后重试', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
              }),
          ),
        ),
    )
    return
  }

  // 静态子资源（JS/CSS/图片/字体）：网络优先，成功则缓存；
  // 失败或非 2xx（如旧版本 hash 文件被删 → 404）回退到缓存同名资源，再不行回退外壳，
  // 避免「裂图 / 缓动条一直转」卡在首屏。
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, copy))
          return res
        }
        // 旧 hash 资源 404：优先回退缓存同名副本，其次回退外壳
        return caches.match(e.request).then((r) => r || caches.match('./index.html').then((i) => i || res))
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  )
})

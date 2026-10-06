/* 询单登记 Service Worker
 * - 预缓存应用外壳；导航与静态资源一律「缓存优先」（安卓冷启动零网络等待，秒开）
 * - 缓存名含构建时间戳（构建脚本自动注入），每次发版自动检测并接管
 * - Supabase 等跨域 API 请求一律直连网络，不做缓存
 * 发版链路：sw.js 内容每次构建必变 → 浏览器 update 检测到新 SW → install 阶段重新预缓存
 * 新外壳 → skipWaiting 接管 → 页面自动刷新 → 加载新 hash 资源（miss 时走网络并回填缓存）
 */
const CACHE = 'xundan-' + '1791263445160'
// 外壳底线：只有它必须成功——拿不到 index.html 的新外壳等于「离线打不开」，
// 宁可让本次安装失败（旧版本继续可用），也不要装出一个空壳。
const CORE = ['./index.html']
// 其余外壳与构建产物：逐项容错
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png']
// 构建脚本注入的全量资源清单（./assets/ 下带 hash 的 JS/CSS）。
// 更新时在 SW 安装阶段后台预取全部资源 → skipWaiting 后 reload 首开全部缓存命中，秒进系统
const ASSETS = ["./assets/charts-CLHYaTue.js","./assets/commission-D90N9rPp.js","./assets/Customers-DBvDipUv.js","./assets/CustomSelect-D2CE_6JT.js","./assets/Dashboard-DeTTyiu6.js","./assets/fetchAll-dQkdBPMg.js","./assets/index-Ba8AW-H4.js","./assets/index-eTL1udgc.css","./assets/Inquiries-Dzscel0_.js","./assets/MoneyInput-Dc1Woyp4.js","./assets/react-vnpKpG3P.js","./assets/RegisterInquiry-CxAtBMjw.js","./assets/Reports-BX69XRyQ.js","./assets/Settings-BzImPQZR.js","./assets/supabase-3Te545q_.js"]

// 单项预缓存，带超时。没有超时是致命的：只要有一个请求卡住（跨境网络很常见），
// install 就永远不结束 → 新版本 SW 永远进不了 waiting → 前端点「立即更新」只能
// 干等到超时后报「下载未完成」，重试也一样。超时后跳过该项，运行时 fetch 会回填。
// noHttpCache：外壳用 cache:'reload' 绕开 HTTP 缓存（GitHub Pages 的 index.html 带
// max-age=600），否则刚发版时新 SW 可能把旧的 index.html 存进新缓存，更新后外壳还是旧的。
// 带 hash 的 assets 内容不可变，不需要绕，省一次下载。
const CORE_TIMEOUT = 25000
const ITEM_TIMEOUT = 20000
function preloadOne(c, url, timeoutMs, noHttpCache) {
  const req = new Request(url, noHttpCache ? { cache: 'reload' } : undefined)
  return Promise.race([
    c.add(req),
    new Promise((_, reject) => setTimeout(() => reject(new Error('precache timeout: ' + url)), timeoutMs)),
  ])
}

self.addEventListener('install', (e) => {
  // 不自动 skipWaiting：新版本安装后进入 waiting，由用户点「立即更新」
  // （postMessage SKIP_WAITING）才接管，避免发版瞬间强刷打断用户正在填写的表单
  e.waitUntil(
    (async () => {
      const c = await caches.open(CACHE)
      // 底线：失败即抛出 → 本次安装失败 → 旧版本继续可用（前端「立即更新」有强制刷新兜底）
      await Promise.all(CORE.map((p) => preloadOne(c, p, CORE_TIMEOUT, true)))
      // 其余逐项容错：个别 404 / 超时都不阻塞安装，运行时 fetch 会兜底回填
      await Promise.all([
        ...SHELL.map((p) => preloadOne(c, p, ITEM_TIMEOUT, true).catch(() => {})),
        ...ASSETS.map((p) => preloadOne(c, p, ITEM_TIMEOUT, false).catch(() => {})),
      ])
    })(),
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

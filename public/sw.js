const CACHE_NAME = 'famioo-shell-v1'
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/famioo-app-icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(async () => (await caches.match('/index.html')) || Response.error()),
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.svg') || url.pathname.endsWith('.webmanifest')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        return response
      })),
    )
  }
})


self.addEventListener('push', (event) => {
  let payload = {
    title: 'Famioo',
    body: 'You have a new family reminder.',
    icon: '/famioo-icon-192.png',
    badge: '/famioo-icon-192.png',
    tag: 'famioo-notification',
    url: '/app',
  }

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() }
    } catch {
      payload.body = event.data.text() || payload.body
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Famioo', {
      body: payload.body,
      icon: payload.icon || '/famioo-icon-192.png',
      badge: payload.badge || '/famioo-icon-192.png',
      tag: payload.tag || 'famioo-notification',
      data: { url: payload.url || '/app' },
      renotify: false,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = new URL(event.notification.data?.url || '/app', self.location.origin).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    for (const client of windows) {
      if ('focus' in client && new URL(client.url).origin === self.location.origin) {
        if ('navigate' in client) await client.navigate(targetUrl)
        return client.focus()
      }
    }

    if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
  })())
})

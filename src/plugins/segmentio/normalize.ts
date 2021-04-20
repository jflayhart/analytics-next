import { CookieAttributes, get as getCookie, set as setCookie } from 'js-cookie'
import { Analytics } from '../../analytics'
import { LegacySettings } from '../../browser'
import { SegmentEvent } from '../../core/events'
import { tld } from '../../core/user/tld'
import { SegmentFacade } from '../../lib/to-facade'
import { SegmentioSettings } from './index'

let domain: string | undefined = undefined
try {
  domain = tld(new URL(window.location.href))
} catch (_) {
  domain = undefined
}

const cookieOptions: CookieAttributes = {
  expires: 31536000000, // 1 year
  secure: false,
  path: '/',
}

if (domain) {
  cookieOptions.domain = domain
}

export function sCookie(key: string, value: string): string | undefined {
  return setCookie(key, value, cookieOptions)
}

type Ad = { id: string; type: string }

const version = process.env.VERSION

export function ampId(): string | undefined {
  const ampId = getCookie('_ga')
  if (ampId && ampId.startsWith('amp')) {
    return ampId
  }
}

export function utm(query: string): Record<string, string> {
  if (query.startsWith('?')) {
    query = query.substring(1)
  }
  query = query.replace(/\?/g, '&')

  return query.split('&').reduce((acc, str) => {
    const [k, v] = str.split('=')
    if (k.includes('utm_')) {
      let utmParam = k.substr(4)
      if (utmParam === 'campaign') {
        utmParam = 'name'
      }
      acc[utmParam] = v
    }
    return acc
  }, {} as Record<string, string>)
}

function ads(query: string): Ad | undefined {
  const queryIds: Record<string, string> = {
    btid: 'dataxu',
    urid: 'millennial-media',
  }

  if (query.startsWith('?')) {
    query = query.substring(1)
  }
  query = query.replace(/\?/g, '&')
  const parts = query.split('&')

  for (const part of parts) {
    const [k, v] = part.split('=')
    if (queryIds[k]) {
      return {
        id: v,
        type: queryIds[k],
      }
    }
  }
}

function referrerId(query: string, ctx: SegmentEvent['context']): void {
  let stored = getCookie('s:context.referrer')
  let ad = ads(query)

  stored = stored ? JSON.parse(stored) : undefined
  ad = ad ?? (stored as Ad | undefined)

  if (!ad) {
    return
  }

  if (ctx) {
    ctx.referrer = { ...ctx.referrer, ...ad }
  }

  setCookie('s:context.referrer', JSON.stringify(ad), cookieOptions)
}

export function normalize(
  analytics: Analytics,
  json: ReturnType<SegmentFacade['json']>,
  settings?: SegmentioSettings,
  integrations?: LegacySettings['integrations']
): object {
  const user = analytics.user()
  const query = window.location.search

  json.context = json.context ?? json.options ?? {}
  const ctx = json.context

  delete json.options
  json.writeKey = settings?.apiKey
  ctx.userAgent = window.navigator.userAgent

  // @ts-ignore
  const locale = navigator.userLanguage || navigator.language

  if (typeof ctx.locale === 'undefined' && typeof locale !== 'undefined') {
    ctx.locale = locale
  }

  if (!ctx.library) {
    ctx.library = { name: 'analytics.js', version: `next-${version}` }
  }

  if (query && !ctx.campaign) {
    ctx.campaign = utm(query)
  }

  referrerId(query, ctx)

  json.userId = json.userId || user.id()
  json.anonymousId = user.anonymousId()
  json.sentAt = new Date()
  json.timestamp = new Date()

  const failed = analytics.queue.failedInitializations || []
  if (failed.length > 0) {
    json._metadata = { failedInitializations: failed }
  }

  const bundled: string[] = []
  const unbundled: string[] = []

  for (const key in integrations) {
    const integration = integrations[key]
    if (key === 'Segment.io') {
      bundled.push(key)
    }
    if (integration.bundlingStatus === 'bundled') {
      bundled.push(key)
    }
    if (integration.bundlingStatus === 'unbundled') {
      unbundled.push(key)
    }
  }

  // TODO: context 3-sev-substantial-owl-2021-03-30
  // This will make sure that the disabled cloud mode destinations will be
  // included in the unbundled list. Not sure if that's important tho.
  for (const settingsUnbundled of settings?.unbundledIntegrations || []) {
    if (!unbundled.includes(settingsUnbundled)) {
      unbundled.push(settingsUnbundled)
    }
  }

  const configIds = settings?.maybeBundledConfigIds ?? {}
  const bundledConfigIds: string[] = []

  bundled.sort().forEach((name) => {
    ;(configIds[name] ?? []).forEach((id) => {
      bundledConfigIds.push(id)
    })
  })

  if (settings?.addBundledMetadata !== false) {
    json._metadata = {
      ...json._metadata,
      bundled: bundled.sort(),
      unbundled: unbundled.sort(),
      bundledIds: bundledConfigIds,
    }
  }

  const amp = ampId()
  if (amp) {
    ctx.amp = { id: amp }
  }

  return json
}

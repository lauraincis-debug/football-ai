// Récupération des matchs du jour et de demain (données réelles ou repli simulé)
import { mulberry32, slugify } from './model'

export const PROVIDERS = {
  demo: { id: 'demo', label: 'TheSportsDB', sub: 'Gratuit • sans clé', needsKey: false },
  'api-football': { id: 'api-football', label: 'API-Football', sub: 'api-sports.io', needsKey: true },
  'football-data': { id: 'football-data', label: 'Football-Data', sub: 'football-data.org', needsKey: true },
}

const pad = n => String(n).padStart(2, '0')

export function isoDate(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function dayLabel(offset = 0) {
  if (offset === 0) return "Aujourd'hui"
  if (offset === 1) return 'Demain'
  return `J+${offset}`
}

export function hashStr(str = '') {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619)
  }
  return Math.abs(h)
}

function initials(name = '') {
  return name
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(w => w[0])
    .join('')
    .toUpperCase()
}

/** Profil déterministe d'une équipe : même nom = même rating/forme/xG. */
export function teamProfile(name = 'Équipe') {
  const h = hashStr(name)
  const rating = 64 + (h % 28) // 64 → 91
  const rnd = mulberry32(h)
  const form = Array.from({ length: 5 }, () => {
    const r = rnd()
    return r > 0.52 ? 'W' : r > 0.24 ? 'D' : 'L'
  }).join('')
  const xg = 0.75 + (rating - 60) * 0.045 + ((h >> 7) % 25) / 100
  return {
    name,
    short: initials(name),
    rating,
    form,
    xg: +xg.toFixed(2),
  }
}

function normalize(raw) {
  const home = raw.home || 'Domicile'
  const away = raw.away || 'Extérieur'
  const hp = teamProfile(home)
  const ap = teamProfile(away)
  const kickoff = raw.kickoff || ''
  return {
    id: raw.id || `${slugify(home)}-${slugify(away)}-${kickoff.slice(0, 10)}`,
    home,
    away,
    league: raw.league || 'Match amical',
    kickoff,
    date: kickoff.slice(0, 10),
    status: raw.status || 'À venir',
    homeRating: hp.rating,
    awayRating: ap.rating,
    homeForm: hp.form,
    awayForm: ap.form,
    homeXg: hp.xg,
    awayXg: ap.xg,
    homeShort: hp.short,
    awayShort: ap.short,
    simulated: !!raw.simulated,
    source: raw.source || 'api',
  }
}

async function withTimeout(url, options = {}, ms = 9000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/* ---------- fournisseurs ---------- */
async function fetchTheSportsDB(offsets) {
  const collected = []
  for (const off of offsets) {
    const d = isoDate(off)
    // clé gratuite : eventsday sans filtre de sport (le paramètre s= est premium)
    const data = await withTimeout(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${d}`)
    const events = (data?.events || []).filter(
      ev => !ev.strSport || ev.strSport === 'Soccer'
    )
    events.slice(0, 60).forEach(ev => {
      if (!ev.strHomeTeam || !ev.strAwayTeam) return
      collected.push(
        normalize({
          id: ev.idEvent || `${slugify(ev.strHomeTeam)}-${slugify(ev.strAwayTeam)}-${d}`,
          home: ev.strHomeTeam,
          away: ev.strAwayTeam,
          league: ev.strLeague || 'Football',
          kickoff: `${ev.dateEvent || d}T${ev.strTime || '20:00:00'}`,
          status: ev.strStatus || 'Not Started',
          source: 'thesportsdb',
        })
      )
    })
  }
  return collected
}

async function fetchApiFootball(offsets, apiKey) {
  if (!apiKey) throw new Error('Clé API-Football manquante')
  const collected = []
  for (const off of offsets) {
    const d = isoDate(off)
    const data = await withTimeout(`https://v3.football.api-sports.io/fixtures?date=${d}`, {
      headers: { 'x-apisports-key': apiKey },
    })
    if (data?.errors && Object.keys(data.errors).length) {
      throw new Error(Object.values(data.errors).join(' • '))
    }
    ;(data?.response || []).forEach(r => {
      collected.push(
        normalize({
          id: String(r.fixture?.id),
          home: r.teams?.home?.name,
          away: r.teams?.away?.name,
          league: r.league?.name || 'Football',
          kickoff: r.fixture?.date,
          status: r.fixture?.status?.short || 'NS',
          source: 'api-football',
        })
      )
    })
  }
  return collected
}

async function fetchFootballData(offsets, apiKey) {
  if (!apiKey) throw new Error('Clé Football-Data manquante')
  const from = isoDate(Math.min(...offsets))
  const to = isoDate(Math.max(...offsets))
  const data = await withTimeout(
    `https://api.football-data.org/v4/matches?dateFrom=${from}&dateTo=${to}`,
    { headers: { 'X-Auth-Token': apiKey } }
  )
  if (!data?.matches) throw new Error(data?.message || 'Réponse invalide')
  return data.matches.map(m =>
    normalize({
      id: String(m.id),
      home: m.homeTeam?.name,
      away: m.awayTeam?.name,
      league: m.competition?.name || 'Football',
      kickoff: m.utcDate,
      status: m.status || 'SCHEDULED',
      source: 'football-data',
    })
  )
}

/* ---------- repli simulé (si API bloquée / quota) ---------- */
const SIM_LEAGUES = {
  'Ligue 1': ['Paris SG', 'Marseille', 'Lyon', 'Monaco', 'Lille', 'Nice', 'Lens', 'Rennes'],
  'Premier League': ['Manchester City', 'Arsenal', 'Liverpool', 'Chelsea', 'Tottenham', 'Manchester Utd', 'Newcastle', 'Aston Villa'],
  LaLiga: ['Real Madrid', 'FC Barcelona', 'Atlético Madrid', 'Athletic Bilbao', 'Real Sociedad', 'Villarreal', 'Betis', 'Sevilla'],
  'Serie A': ['Inter', 'Milan', 'Juventus', 'Napoli', 'Roma', 'Atalanta', 'Lazio', 'Fiorentina'],
  Bundesliga: ['Bayern Munich', 'Dortmund', 'Leverkusen', 'Leipzig', 'Stuttgart', 'Frankfurt', 'Wolfsburg', 'Freiburg'],
  'Champions League': ['Paris SG', 'Real Madrid', 'Manchester City', 'Bayern Munich', 'Inter', 'Arsenal', 'FC Barcelona', 'Dortmund'],
}

export function simulatedFixtures(offsets = [0, 1]) {
  const out = []
  offsets.forEach(off => {
    const date = isoDate(off)
    Object.entries(SIM_LEAGUES).forEach(([league, teams], li) => {
      const rnd = mulberry32(hashStr(date + league) % 100000)
      const pool = [...teams]
      const pairs = []
      const count = league === 'Champions League' ? 2 : 3
      for (let i = 0; i < count; i++) {
        const a = pool.splice(Math.floor(rnd() * pool.length), 1)[0]
        const b = pool.splice(Math.floor(rnd() * pool.length), 1)[0]
        if (a && b) pairs.push([a, b])
      }
      const times = ['16:00', '18:30', '21:00']
      pairs.forEach(([home, away], i) => {
        out.push(
          normalize({
            id: `sim-${date}-${slugify(home)}-${slugify(away)}`,
            home,
            away,
            league,
            kickoff: `${date}T${times[(i + li) % times.length]}:00`,
            status: 'À venir',
            simulated: true,
            source: 'simulation',
          })
        )
      })
    })
  })
  return out
}

/**
 * Récupère les matchs du jour + demain.
 * @returns {Promise<{matches:Array, source:string, warning:string|null}>}
 */
export async function fetchTodayTomorrow({ provider = 'demo', apiKey = '', offsets = [0, 1] } = {}) {
  let warning = null
  let source = provider

  try {
    let matches = []
    if (provider === 'api-football') matches = await fetchApiFootball(offsets, apiKey)
    else if (provider === 'football-data') matches = await fetchFootballData(offsets, apiKey)
    else matches = await fetchTheSportsDB(offsets)

    // on ne garde que les matchs des dates demandées
    const days = offsets.map(o => isoDate(o))
    matches = matches.filter(m => !m.date || days.includes(m.date.replace(/\//g, '-')))
    matches.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)))

    if (matches.length > 0) {
      return { matches, source, warning: null }
    }
    warning = `Aucun match renvoyé par ${PROVIDERS[provider]?.label || provider} pour ces dates. Calendrier simulé affiché en attendant.`
  } catch (err) {
    const msg = err?.name === 'AbortError' ? 'délai dépassé' : err?.message || 'erreur réseau'
    warning = `Connexion à ${PROVIDERS[provider]?.label || provider} impossible (${msg}). Repli sur le calendrier simulé — vérifie la clé API ou le quota, ou réessaie.`
  }

  return { matches: simulatedFixtures(offsets), source: 'simulation', warning }
}

export function formatKickoff(kickoff) {
  if (!kickoff) return '—'
  const d = new Date(kickoff)
  if (Number.isNaN(d.getTime())) return kickoff
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export function formatDay(kickoff) {
  if (!kickoff) return ''
  const d = new Date(kickoff)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })
}

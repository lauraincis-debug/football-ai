// Mémoire persistante de l'IA : prédictions, résultats, leçons, modèle.
// Store externe partagé (useSyncExternalStore) → tous les modules voient la même mémoire.
import { useMemo, useSyncExternalStore } from 'react'
import {
  OUTCOMES,
  OUTCOME_LABEL,
  computeStats,
  consolidate,
  defaultModel,
  learn,
  makeFeatures,
  mulberry32,
  predict,
  slugify,
  uid,
} from './model'

const STORAGE_KEY = 'footballai.memory.v3'
const MAX_LESSONS = 80

/* ---------- amorçage : historique de démonstration ---------- */
const SEED_TEAMS = [
  { n: 'Paris SG', r: 88 }, { n: 'Marseille', r: 79 }, { n: 'Lyon', r: 77 },
  { n: 'Monaco', r: 80 }, { n: 'Lille', r: 78 }, { n: 'Real Madrid', r: 92 },
  { n: 'FC Barcelona', r: 87 }, { n: 'Atlético Madrid', r: 84 }, { n: 'Manchester City', r: 91 },
  { n: 'Arsenal', r: 86 }, { n: 'Liverpool', r: 88 }, { n: 'Chelsea', r: 82 },
  { n: 'Bayern Munich', r: 89 }, { n: 'Dortmund', r: 83 }, { n: 'Leverkusen', r: 84 },
  { n: 'Inter', r: 85 }, { n: 'Milan', r: 82 }, { n: 'Juventus', r: 81 },
]

const SEED_LEAGUES = ['Ligue 1', 'Premier League', 'LaLiga', 'Serie A', 'Bundesliga']

function createSeed() {
  const rnd = mulberry32(20260214)
  let model = defaultModel()
  const memories = []
  const lessons = []
  const truth = defaultModel({
    temperature: 1.45,
    drawBase: 0.55,
    weights: { rating: 2.05, form: 0.3, xg: 1.0, home: 0.36 },
  })
  const SEED_COUNT = 42
  const start = Date.now() - (SEED_COUNT - 1) * 86400000

  for (let i = 0; i < SEED_COUNT; i++) {
    const league = SEED_LEAGUES[i % SEED_LEAGUES.length]
    const idxA = Math.floor(rnd() * SEED_TEAMS.length)
    let idxB = Math.floor(rnd() * SEED_TEAMS.length)
    if (idxB === idxA) idxB = (idxB + 1) % SEED_TEAMS.length
    const home = SEED_TEAMS[idxA]
    const away = SEED_TEAMS[idxB]

    const mkForm = () =>
      Array.from({ length: 5 }, () => {
        const r = rnd()
        return r > 0.5 ? 'W' : r > 0.25 ? 'D' : 'L'
      }).join('')

    const match = {
      home: home.n,
      away: away.n,
      league,
      kickoff: new Date(start + i * 86400000 + 20 * 3600000).toISOString(),
      homeRating: home.r,
      awayRating: away.r,
      homeForm: mkForm(),
      awayForm: mkForm(),
      homeXg: +(0.7 + (home.r - 60) * 0.05 + rnd() * 0.3).toFixed(2),
      awayXg: +(0.7 + (away.r - 60) * 0.05 + rnd() * 0.3).toFixed(2),
    }

    const features = makeFeatures(match)
    const truthProbs = predict(truth, features).list
    const u = rnd()
    let outcomeIdx = 0
    if (u > truthProbs[0] + truthProbs[1]) outcomeIdx = 2
    else if (u > truthProbs[0]) outcomeIdx = 1

    const p = predict(model, features)
    const outcome = OUTCOMES[outcomeIdx]
    const scoreFor = outcome === 'home' ? `${2 + (i % 2)} - ${i % 2}` : outcome === 'away' ? `${i % 2} - ${2 + (i % 2)}` : '1 - 1'

    const res = learn(model, features, outcomeIdx, { lr: 0.075, probs: p.list })

    memories.push({
      id: `seed_${i}`,
      matchId: `seed_${i}`,
      at: new Date(start + i * 86400000 + 12 * 3600000).toISOString(),
      resolvedAt: new Date(start + i * 86400000 + 23 * 3600000).toISOString(),
      home: home.n,
      away: away.n,
      league,
      kickoff: match.kickoff,
      features,
      probs: p.probs,
      list: p.list,
      pick: p.pick,
      confidence: +p.confidence.toFixed(1),
      scoreline: p.scoreline,
      xg: { home: +p.lambdaHome.toFixed(2), away: +p.lambdaAway.toFixed(2) },
      outcome,
      actualScore: scoreFor,
      correct: res.correct,
      brier: res.brier,
      source: 'amorçage',
      seeded: true,
    })

    lessons.push({
      id: `lesson_seed_${i}`,
      at: new Date(start + i * 86400000 + 23 * 3600000).toISOString(),
      memoryId: `seed_${i}`,
      match: `${home.n} – ${away.n}`,
      correct: res.correct,
      text: res.correct
        ? `Lecture validée sur ${home.n} – ${away.n} : ${OUTCOME_LABEL[outcome]} annoncé à ${(p.confidence).toFixed(0)}%. Poids renforcés (rating ${res.deltaWeights.rating >= 0 ? '+' : ''}${res.deltaWeights.rating.toFixed(3)}, nuls ${res.deltaDraw >= 0 ? '+' : ''}${res.deltaDraw.toFixed(3)}).`
        : `Erreur sur ${home.n} – ${away.n} : l'IA annonçait ${OUTCOME_LABEL[p.pick]} (${p.confidence.toFixed(0)}%) mais le résultat fut ${OUTCOME_LABEL[outcome]}. Correction appliquée : rating ${res.deltaWeights.rating >= 0 ? '+' : ''}${res.deltaWeights.rating.toFixed(3)}, forme ${res.deltaWeights.form >= 0 ? '+' : ''}${res.deltaWeights.form.toFixed(3)}, xG ${res.deltaWeights.xg >= 0 ? '+' : ''}${res.deltaWeights.xg.toFixed(3)}.`,
      seeded: true,
    })

    model = res.model
  }

  return {
    version: 3,
    createdAt: new Date().toISOString(),
    model: { ...model, generation: 3, epochs: 12, updatedAt: new Date().toISOString() },
    memories,
    lessons: lessons.slice(-MAX_LESSONS),
    autoLearn: true,
  }
}

/* ---------- persistance ---------- */
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return createSeed()
    const parsed = JSON.parse(raw)
    if (!parsed?.model || !Array.isArray(parsed.memories)) return createSeed()
    return {
      version: 3,
      createdAt: parsed.createdAt || new Date().toISOString(),
      model: { ...defaultModel(), ...parsed.model, weights: { ...defaultModel().weights, ...(parsed.model.weights || {}) } },
      memories: parsed.memories,
      lessons: parsed.lessons || [],
      autoLearn: parsed.autoLearn !== false,
    }
  } catch {
    return createSeed()
  }
}

let state = load()
const listeners = new Set()

function emit() {
  listeners.forEach(l => l())
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* quota dépassé : on continue en mémoire volatile */
  }
}

function setState(patch) {
  state = { ...state, ...patch }
  persist()
  emit()
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getMemoryState() {
  return state
}

/* ---------- helpers ---------- */
function outcomeFromScores(h, a) {
  if (Number(h) > Number(a)) return 'home'
  if (Number(h) < Number(a)) return 'away'
  return 'draw'
}

function plausibleScore(outcome, seed = 1) {
  if (outcome === 'home') return `${1 + (seed % 2)} - ${seed % 2}`
  if (outcome === 'away') return `${seed % 2} - ${1 + (seed % 2)}`
  return `${seed % 2} - ${seed % 2}`
}

function buildLesson(mem, res, outcomeKey, actualScore) {
  const sign = v => `${v >= 0 ? '+' : ''}${v.toFixed(3)}`
  const base = `${mem.home} – ${mem.away} (${mem.league})`
  if (res.correct) {
    return {
      correct: true,
      text: `✅ ${base} : ${OUTCOME_LABEL[outcomeKey]} anticipé à ${mem.confidence.toFixed(0)}%, score réel ${actualScore}. Le modèle renforce ses poids — rating ${sign(res.deltaWeights.rating)}, forme ${sign(res.deltaWeights.form)}, xG ${sign(res.deltaWeights.xg)}, biais nul ${sign(res.deltaDraw)}.`,
    }
  }
  const errPts = Math.abs(100 * (res.probs[OUTCOMES.indexOf(outcomeKey)] ?? 0) - mem.confidence)
  return {
    correct: false,
    text: `❌ ${base} : l'IA annonçait ${OUTCOME_LABEL[mem.pick]} à ${mem.confidence.toFixed(0)}%, résultat ${OUTCOME_LABEL[outcomeKey]} (${actualScore}). Erreur de ${errPts.toFixed(0)} pts de probabilité corrigée : rating ${sign(res.deltaWeights.rating)}, forme ${sign(res.deltaWeights.form)}, xG ${sign(res.deltaWeights.xg)}, avantage terrain ${sign(res.deltaWeights.home)}, biais nul ${sign(res.deltaDraw)}.`,
  }
}

/* ---------- actions ---------- */
function record(match, { source = 'fixtures', replace = false } = {}) {
  const s = state
  const matchId =
    match.matchId ||
    match.id ||
    `${slugify(match.home)}-${slugify(match.away)}-${String(match.kickoff || '').slice(0, 10)}`

  const existing = s.memories.find(m => m.matchId === matchId)
  if (existing && !replace) return existing

  const features = match.features || makeFeatures(match)
  const p = predict(s.model, features)
  const mem = {
    id: uid(),
    matchId,
    at: new Date().toISOString(),
    home: match.home,
    away: match.away,
    league: match.league || 'Football',
    kickoff: match.kickoff || '',
    features,
    probs: p.probs,
    list: p.list,
    pick: p.pick,
    confidence: +p.confidence.toFixed(1),
    scoreline: p.scoreline,
    xg: { home: +p.lambdaHome.toFixed(2), away: +p.lambdaAway.toFixed(2) },
    outcome: null,
    simulated: !!match.simulated,
    source,
    modelGeneration: s.model.generation,
  }

  const memories = replace && existing
    ? s.memories.map(m => (m.matchId === matchId ? mem : m))
    : [...s.memories, mem]

  setState({ memories })
  return mem
}

function resolve(memoryId, scoreHome, scoreAway) {
  const s = state
  const mem = s.memories.find(m => m.id === memoryId)
  if (!mem || mem.outcome) return null
  if (scoreHome === '' || scoreAway === '' || Number.isNaN(Number(scoreHome)) || Number.isNaN(Number(scoreAway))) {
    return null
  }

  const outcomeKey = outcomeFromScores(scoreHome, scoreAway)
  const outcomeIdx = OUTCOMES.indexOf(outcomeKey)
  const res = learn(s.model, mem.features, outcomeIdx, { lr: 0.085, probs: mem.list })
  const lesson = buildLesson(mem, res, outcomeKey, `${scoreHome} - ${scoreAway}`)

  const memories = s.memories.map(m =>
    m.id === memoryId
      ? {
          ...m,
          outcome: outcomeKey,
          actualScore: `${scoreHome} - ${scoreAway}`,
          correct: res.correct,
          brier: res.brier,
          resolvedAt: new Date().toISOString(),
        }
      : m
  )

  const lessons = [
    {
      id: uid(),
      at: new Date().toISOString(),
      memoryId,
      match: `${mem.home} – ${mem.away}`,
      correct: lesson.correct,
      text: lesson.text,
    },
    ...s.lessons,
  ].slice(0, MAX_LESSONS)

  setState({ memories, model: res.model, lessons })
  return { correct: res.correct, lesson: lesson.text, model: res.model }
}

function resolveQuick(memoryId, outcomeKey) {
  const mem = state.memories.find(m => m.id === memoryId)
  const score = plausibleScore(outcomeKey, state.memories.length + 3)
  const [h, a] = score.split(' - ')
  return resolve(memoryId, h, a)
}

function consolidateNow() {
  const s = state
  const samples = s.memories
    .filter(m => m.outcome && m.features)
    .map(m => ({ features: m.features, outcomeIdx: OUTCOMES.indexOf(m.outcome), id: m.id }))
  if (!samples.length) return null
  const { model, before, after } = consolidate(s.model, samples)
  if (!after) return null

  const lessons = [
    {
      id: uid(),
      at: new Date().toISOString(),
      memoryId: null,
      match: 'Consolidation mémoire',
      correct: after.accuracy >= before.accuracy,
      text: `🧠 Consolidation sur ${samples.length} matchs (120 epochs, early stopping) : précision ${before.accuracy.toFixed(1)}% → ${after.accuracy.toFixed(1)}%, Brier ${before.brier.toFixed(3)} → ${after.brier.toFixed(3)}. Modèle promu en génération ${model.generation}.`,
    },
    ...s.lessons,
  ].slice(0, MAX_LESSONS)

  setState({ model, lessons })
  return { before, after, generation: model.generation }
}

function simulateResults(count = 8) {
  const s = state
  let model = s.model
  const rnd = mulberry32(hashSeed(Date.now()))
  const teams = [
    'Paris SG', 'Marseille', 'Real Madrid', 'FC Barcelona', 'Manchester City', 'Arsenal',
    'Liverpool', 'Bayern Munich', 'Inter', 'Milan', 'Dortmund', 'Atlético Madrid',
  ]
  const leagues = ['Ligue 1', 'LaLiga', 'Premier League', 'Serie A', 'Bundesliga']
  const newMemories = []
  const newLessons = []

  for (let i = 0; i < count; i++) {
    const h = teams[Math.floor(rnd() * teams.length)]
    let a = teams[Math.floor(rnd() * teams.length)]
    if (a === h) a = teams[(teams.indexOf(h) + 1) % teams.length]
    const match = {
      home: h,
      away: a,
      league: leagues[Math.floor(rnd() * leagues.length)],
      kickoff: new Date(Date.now() - i * 3600000).toISOString(),
      homeRating: 64 + Math.floor(rnd() * 28),
      awayRating: 64 + Math.floor(rnd() * 28),
      homeForm: Array.from({ length: 5 }, () => (rnd() > 0.5 ? 'W' : rnd() > 0.4 ? 'D' : 'L')).join(''),
      awayForm: Array.from({ length: 5 }, () => (rnd() > 0.5 ? 'W' : rnd() > 0.4 ? 'D' : 'L')).join(''),
      homeXg: +(0.8 + rnd() * 1.2).toFixed(2),
      awayXg: +(0.8 + rnd() * 1.2).toFixed(2),
    }
    const features = makeFeatures(match)
    const p = predict(model, features)

    // résultat échantillonné autour des probabilités (bruit réaliste)
    const sharpened = p.list.map(v => Math.pow(v, 1.25))
    const sum = sharpened.reduce((x, y) => x + y, 0)
    const norm = sharpened.map(v => v / sum)
    const u = rnd()
    let outcomeIdx = 0
    if (u > norm[0] + norm[1]) outcomeIdx = 2
    else if (u > norm[0]) outcomeIdx = 1
    const outcome = OUTCOMES[outcomeIdx]
    const score = plausibleScore(outcome, i + 2)

    const res = learn(model, features, outcomeIdx, { lr: 0.07, probs: p.list })
    const mem = {
      id: uid(),
      matchId: `simres-${Date.now()}-${i}`,
      at: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
      home: h,
      away: a,
      league: match.league,
      kickoff: match.kickoff,
      features,
      probs: p.probs,
      list: p.list,
      pick: p.pick,
      confidence: +p.confidence.toFixed(1),
      scoreline: p.scoreline,
      xg: { home: +p.lambdaHome.toFixed(2), away: +p.lambdaAway.toFixed(2) },
      outcome,
      actualScore: score,
      correct: res.correct,
      brier: res.brier,
      source: 'entraînement démo',
      simulated: true,
    }
    newMemories.push(mem)
    const lesson = buildLesson(mem, res, outcome, score)
    newLessons.push({
      id: uid(),
      at: new Date().toISOString(),
      memoryId: mem.id,
      match: `${h} – ${a}`,
      correct: lesson.correct,
      text: lesson.text,
    })
    model = res.model
  }

  setState({
    model,
    memories: [...s.memories, ...newMemories],
    lessons: [...newLessons.reverse(), ...s.lessons].slice(0, MAX_LESSONS),
  })
  return newMemories.length
}

function hashSeed(n) {
  let h = n % 2147483647
  return h <= 0 ? 1 : h
}

function resetMemories({ reseed = true } = {}) {
  if (reseed) {
    const fresh = createSeed()
    setState({ ...fresh })
  } else {
    setState({
      version: 3,
      createdAt: new Date().toISOString(),
      model: defaultModel(),
      memories: [],
      lessons: [],
      autoLearn: state.autoLearn,
    })
  }
}

function exportMemory() {
  return JSON.stringify(
    { exportedAt: new Date().toISOString(), model: state.model, memories: state.memories, lessons: state.lessons },
    null,
    2
  )
}

function importMemory(json) {
  try {
    const parsed = JSON.parse(json)
    if (!parsed?.model || !Array.isArray(parsed.memories)) throw new Error('Format invalide')
    setState({
      model: { ...defaultModel(), ...parsed.model, weights: { ...defaultModel().weights, ...parsed.model.weights } },
      memories: parsed.memories,
      lessons: parsed.lessons || [],
    })
    return true
  } catch {
    return false
  }
}

function setAutoLearn(v) {
  setState({ autoLearn: !!v })
}

export const actions = {
  record,
  resolve,
  resolveQuick,
  consolidateNow,
  simulateResults,
  resetMemories,
  exportMemory,
  importMemory,
  setAutoLearn,
}

/** Hook principal : état partagé + statistiques dérivées. */
export function useMemory() {
  const snapshot = useSyncExternalStore(subscribe, getMemoryState, getMemoryState)
  const stats = useMemo(() => computeStats(snapshot.memories, snapshot.model), [snapshot.memories, snapshot.model])
  return { state: snapshot, model: snapshot.model, memories: snapshot.memories, lessons: snapshot.lessons, autoLearn: snapshot.autoLearn, stats }
}

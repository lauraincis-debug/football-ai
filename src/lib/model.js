// FootballAI — moteur de prédiction + mémoire apprenante
// Modèle linéaire multi-classe (softmax 1/N/2) entraîné en ligne (SGD)
// Chaque résultat observé met à jour les poids : l'IA apprend de ses erreurs.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export const OUTCOMES = ['home', 'draw', 'away']
export const OUTCOME_LABEL = {
  home: 'Victoire domicile',
  draw: 'Match nul',
  away: 'Victoire extérieur',
}
export const OUTCOME_SHORT = { home: '1', draw: 'N', away: '2' }
export const FEATURE_KEYS = ['rating', 'form', 'xg', 'home']
export const FEATURE_LABEL = {
  rating: 'Niveau / rating',
  form: 'Forme récente',
  xg: 'xG créés',
  home: 'Avantage terrain',
}

/* ---------- utils ---------- */
export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function softmax(z) {
  const m = Math.max(...z)
  const e = z.map(v => Math.exp(v - m))
  const s = e.reduce((a, b) => a + b, 0)
  return e.map(v => v / s)
}

export function formPoints(form = '') {
  return String(form)
    .toUpperCase()
    .split('')
    .reduce((s, c) => s + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0)
}

export function uid() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function slugify(str = '') {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/* ---------- modèle ---------- */
export function defaultModel(overrides = {}) {
  return {
    name: 'FootballAI Memory Engine',
    generation: 1,
    temperature: 1.6,
    bias: 0,
    drawBase: 0.35,
    weights: { rating: 1.6, form: 0.6, xg: 0.5, home: 0.18 },
    samples: 0,
    correct: 0,
    brierSum: 0,
    epochs: 0,
    updatedAt: null,
    ...overrides,
  }
}

/** Extrait les 4 features du modèle depuis un match (ratings/formes/xG). */
export function makeFeatures(m = {}) {
  return {
    rating: clamp(((m.homeRating ?? 80) - (m.awayRating ?? 80)) / 12, -2.4, 2.4),
    form: clamp((formPoints(m.homeForm) - formPoints(m.awayForm)) / 15, -1, 1),
    xg: clamp(((m.homeXg ?? 1.3) - (m.awayXg ?? 1.3)) / 1.5, -1.4, 1.4),
    home: 1,
  }
}

/** Inférence : probabilités 1/N/2, score le plus probable, xG attendus. */
export function predict(model, features) {
  const w = model.weights
  const contributions = {}
  let score = model.bias
  FEATURE_KEYS.forEach(k => {
    contributions[k] = w[k] * features[k]
    score += contributions[k]
  })

  const T = model.temperature || 1.6
  const logits = [score / T, model.drawBase, -score / T]
  const list = softmax(logits)
  const pickIdx = list.indexOf(Math.max(...list))
  const pick = OUTCOMES[pickIdx]

  const lambdaHome = clamp(1.3 + score * 0.42, 0.25, 3.6)
  const lambdaAway = clamp(1.12 - score * 0.38, 0.2, 3.2)

  let gh = Math.round(lambdaHome)
  let ga = Math.round(lambdaAway)
  if (pick === 'home' && gh <= ga) gh = ga + 1
  if (pick === 'away' && ga <= gh) ga = gh + 1
  if (pick === 'draw' && gh !== ga) {
    const v = Math.round((gh + ga) / 2)
    gh = v
    ga = v
  }
  gh = clamp(gh, 0, 5)
  ga = clamp(ga, 0, 5)

  return {
    pick,
    pickIdx,
    list,
    probs: { home: list[0], draw: list[1], away: list[2] },
    score,
    contributions,
    lambdaHome,
    lambdaAway,
    scoreline: `${gh} - ${ga}`,
    confidence: list[pickIdx] * 100,
  }
}

/**
 * Apprentissage en ligne (1 pas de descente de gradient sur l'entropie croisée).
 * `probs` = probabilités stockées au moment de la prédiction (sinon recalculées).
 */
export function learn(model, features, outcomeIdx, opts = {}) {
  const { lr = 0.08, probs = null } = typeof opts === 'number' ? { lr: opts } : opts
  const base = predict(model, features)
  const usedProbs = Array.isArray(probs) ? probs : base.list
  const usedPick = OUTCOMES[usedProbs.indexOf(Math.max(...usedProbs))]

  const y = [0, 0, 0]
  y[outcomeIdx] = 1

  const T = model.temperature || 1.6
  // dL/ds pour logits [s/T, drawBase, -s/T]
  const dS = (usedProbs[0] - y[0] - (usedProbs[2] - y[2])) / T

  const before = { ...model.weights }
  const weights = { ...model.weights }
  FEATURE_KEYS.forEach(k => {
    weights[k] = clamp(weights[k] - lr * dS * features[k], 0.05, 3.2)
  })
  const bias = clamp(model.bias - lr * dS * 0.6, -0.9, 0.9)
  const drawBase = clamp(model.drawBase - lr * (usedProbs[1] - y[1]), 0.05, 1.5)

  const correct = usedPick === OUTCOMES[outcomeIdx]
  const brier = usedProbs.reduce((s, p, i) => s + (p - y[i]) ** 2, 0)

  const deltaWeights = {}
  FEATURE_KEYS.forEach(k => {
    deltaWeights[k] = weights[k] - before[k]
  })

  const next = {
    ...model,
    weights,
    bias,
    drawBase,
    samples: (model.samples || 0) + 1,
    correct: (model.correct || 0) + (correct ? 1 : 0),
    brierSum: (model.brierSum || 0) + brier,
    updatedAt: new Date().toISOString(),
  }

  return {
    model: next,
    correct,
    brier,
    predicted: base,
    probs: usedProbs,
    pick: usedPick,
    deltaWeights,
    deltaBias: bias - model.bias,
    deltaDraw: drawBase - model.drawBase,
  }
}

/** Consolidation : descente de gradient batch sur toute la mémoire (avec early stopping). */
export function consolidate(model, samples, { epochs = 120, lr = 2.0 } = {}) {
  if (!samples || !samples.length) return { model, before: null, after: null }

  const evaluate = m => {
    let correct = 0
    let brier = 0
    samples.forEach(s => {
      const p = predict(m, s.features)
      const y = [0, 0, 0]
      y[s.outcomeIdx] = 1
      if (p.pick === OUTCOMES[s.outcomeIdx]) correct++
      brier += p.list.reduce((a, v, i) => a + (v - y[i]) ** 2, 0)
    })
    return { accuracy: (correct / samples.length) * 100, brier: brier / samples.length }
  }
  const rank = e => e.accuracy - e.brier * 12

  const before = evaluate(model)
  let m = { ...model, weights: { ...model.weights } }
  let best = { model: m, eval: before }

  for (let e = 0; e < epochs; e++) {
    const gw = { rating: 0, form: 0, xg: 0, home: 0 }
    let gBias = 0
    let gDraw = 0
    const n = samples.length
    const T = m.temperature || 1.6
    samples.forEach(s => {
      const p = predict(m, s.features).list
      const y = [0, 0, 0]
      y[s.outcomeIdx] = 1
      const dS = (p[0] - y[0] - (p[2] - y[2])) / T
      FEATURE_KEYS.forEach(k => {
        gw[k] += dS * s.features[k]
      })
      gBias += dS * 0.6
      gDraw += p[1] - y[1]
    })
    const weights = { ...m.weights }
    FEATURE_KEYS.forEach(k => {
      weights[k] = clamp(weights[k] - (lr * gw[k]) / n, 0.05, 3.2)
    })
    m = {
      ...m,
      weights,
      bias: clamp(m.bias - (lr * gBias) / n, -0.9, 0.9),
      drawBase: clamp(m.drawBase - (lr * gDraw) / n, 0.05, 1.5),
    }
    const ev = evaluate(m)
    if (rank(ev) > rank(best.eval)) best = { model: m, eval: ev }
  }

  const after = best.eval
  const next = {
    ...best.model,
    epochs: (best.model.epochs || 0) + epochs,
    generation: (best.model.generation || 1) + 1,
    updatedAt: new Date().toISOString(),
  }
  return { model: next, before, after }
}

/* ---------- statistiques & insights ---------- */
function pct(v) {
  return `${v.toFixed(0)}%`
}

export function computeStats(memories = [], model = defaultModel()) {
  const resolved = memories.filter(m => m.outcome)
  const pending = memories.filter(m => !m.outcome)
  const total = memories.length
  const correct = resolved.filter(m => m.correct).length
  const accuracy = resolved.length ? (correct / resolved.length) * 100 : 0
  const brier = resolved.length ? resolved.reduce((s, m) => s + (m.brier || 0), 0) / resolved.length : 0

  const W = 10
  const last = resolved.slice(-W)
  const prev = resolved.slice(-W * 2, -W)
  const accOf = arr => (arr.length ? (arr.filter(m => m.correct).length / arr.length) * 100 : null)
  const lastAcc = accOf(last)
  const prevAcc = accOf(prev)
  const progress = lastAcc != null && prevAcc != null && prev.length >= 5 ? lastAcc - prevAcc : null

  const curve = resolved.map((m, i) => {
    const from = Math.max(0, i - 7)
    const w = resolved.slice(from, i + 1)
    return {
      n: i + 1,
      acc: +((w.filter(x => x.correct).length / w.length) * 100).toFixed(1),
      brier: +(w.reduce((a, x) => a + (x.brier || 0), 0) / w.length).toFixed(3),
      label: m.at ? new Date(m.at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '',
    }
  })

  const buckets = [
    { min: 0, max: 50, label: '< 50%' },
    { min: 50, max: 65, label: '50–65%' },
    { min: 65, max: 75, label: '65–75%' },
    { min: 75, max: 101, label: '75%+' },
  ].map(b => {
    const arr = resolved.filter(m => (m.confidence || 0) >= b.min && (m.confidence || 0) < b.max)
    return {
      ...b,
      n: arr.length,
      acc: arr.length ? +((arr.filter(m => m.correct).length / arr.length) * 100).toFixed(1) : null,
    }
  })

  const byPick = OUTCOMES.map(o => {
    const arr = resolved.filter(m => m.pick === o)
    return {
      pick: o,
      label: OUTCOME_LABEL[o],
      n: arr.length,
      acc: arr.length ? +((arr.filter(m => m.correct).length / arr.length) * 100).toFixed(1) : null,
    }
  })

  const leagueMap = {}
  resolved.forEach(m => {
    const k = m.league || 'Autre'
    if (!leagueMap[k]) leagueMap[k] = { league: k, n: 0, ok: 0 }
    leagueMap[k].n++
    if (m.correct) leagueMap[k].ok++
  })
  const leagues = Object.values(leagueMap)
    .map(l => ({ ...l, acc: +((l.ok / l.n) * 100).toFixed(1) }))
    .sort((a, b) => b.n - a.n)

  /* ---- insights ---- */
  const insights = []

  if (resolved.length < 8) {
    insights.push({
      type: 'info',
      title: 'La mémoire se construit',
      text: `Encore ${8 - resolved.length} résultat(s) à enregistrer pour dégager des tendances fiables. Chaque résultat renforce le modèle.`,
    })
  }

  if (progress != null) {
    if (progress > 2) {
      insights.push({
        type: 'good',
        title: `Progression de ${progress > 0 ? '+' : ''}${progress.toFixed(0)} pts`,
        text: `Sur les 10 dernières prédictions résolues, la précision atteint ${pct(lastAcc)} contre ${pct(prevAcc)} auparavant. L'apprentissage en ligne fonctionne.`,
      })
    } else if (progress < -2) {
      insights.push({
        type: 'warn',
        title: `Régression récente de ${progress.toFixed(0)} pts`,
        text: `Précision à ${pct(lastAcc)} sur les 10 derniers résultats (contre ${pct(prevAcc)}). Lance une consolidation de la mémoire pour recaler les poids.`,
      })
    }
  }

  const draws = byPick.find(p => p.pick === 'draw')
  if (draws.n >= 3) {
    if (draws.acc < 40) {
      insights.push({
        type: 'warn',
        title: 'Angle mort : les matchs nuls',
        text: `Seulement ${pct(draws.acc)} de réussite sur ${draws.n} nuls prédits. Le biais « nul » (drawBase = ${model.drawBase.toFixed(2)}) est recalibré à chaque résultat pour corriger ça.`,
      })
    } else {
      insights.push({
        type: 'good',
        title: 'Bonne lecture des matchs nuls',
        text: `${pct(draws.acc)} de réussite sur ${draws.n} nuls annoncés — le calibrage du nul est sain.`,
      })
    }
  }

  const high = buckets[3]
  if (high.n >= 3 && high.acc != null && high.acc < 65) {
    insights.push({
      type: 'warn',
      title: 'Suroptimisme détecté',
      text: `Quand l'IA annonce plus de 75% de confiance, elle n'a raison que ${pct(high.acc)} du temps (${high.n} cas). La température du modèle a été abaissée pour tempérer les probas.`,
    })
  } else if (high.n >= 3 && high.acc != null && high.acc >= 80) {
    insights.push({
      type: 'good',
      title: 'Probas hautes fiables',
      text: `${pct(high.acc)} de réussite au-dessus de 75% de confiance (${high.n} cas). Tu peux suivre ces pronostics les yeux fermés.`,
    })
  }

  const home = byPick.find(p => p.pick === 'home')
  const away = byPick.find(p => p.pick === 'away')
  if (home.acc != null && away.acc != null && home.n >= 3 && away.n >= 3) {
    const diff = home.acc - away.acc
    if (Math.abs(diff) >= 12) {
      insights.push({
        type: 'info',
        title: diff > 0 ? 'Meilleur à domicile' : 'Meilleur à l’extérieur',
        text: diff > 0
          ? `+${diff.toFixed(0)} pts de réussite sur les victoires à domicile. L'avantage du terrain est bien capté (poids ${model.weights.home.toFixed(2)}).`
          : `+${Math.abs(diff).toFixed(0)} pts sur les victoires extérieures : le modèle résiste au biais domicile.`,
      })
    }
  }

  if (leagues.length >= 2) {
    const withMin = leagues.filter(l => l.n >= 3)
    if (withMin.length >= 2) {
      const sorted = [...withMin].sort((a, b) => b.acc - a.acc)
      const best = sorted[0]
      const worst = sorted[sorted.length - 1]
      if (best.acc - worst.acc >= 15) {
        insights.push({
          type: 'warn',
          title: `Point faible : ${worst.league}`,
          text: `${pct(worst.acc)} de précision sur ${worst.n} matchs de ${worst.league}, contre ${pct(best.acc)} en ${best.league}. Le modèle apprend plus vite sur les championnats qu'il a le plus vus.`,
        })
      }
    }
  }

  if (resolved.length >= 5) {
    insights.push({
      type: brier < 0.42 ? 'good' : 'info',
      title: `Score de Brier : ${brier.toFixed(3)}`,
      text: brier < 0.42
        ? 'Très bonne calibration des probabilités (0 = parfait). Le modèle ne se contente pas de deviner, il quantifie bien son incertitude.'
        : 'Calibration perfectible. Plus la mémoire grandit, plus ce score baisse : c’est l’objectif de la consolidation.',
    })
  }

  return {
    total,
    resolvedCount: resolved.length,
    pendingCount: pending.length,
    correct,
    accuracy,
    brier,
    lastAcc,
    prevAcc,
    progress,
    curve,
    buckets,
    byPick,
    leagues,
    insights,
    resolved,
    pending,
  }
}

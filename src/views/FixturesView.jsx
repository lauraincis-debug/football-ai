import React, { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays, RefreshCw, Zap, CheckCircle2, AlertCircle, Clock, MapPin,
  Sparkles, ChevronRight, X, Brain, Database, Info, Loader2, Target, TrendingUp,
} from 'lucide-react'
import { fetchTodayTomorrow, formatKickoff, formatDay, isoDate, PROVIDERS } from '../lib/footballApi'
import { makeFeatures, predict, OUTCOME_LABEL, OUTCOME_SHORT, OUTCOMES } from '../lib/model'
import { actions, useMemory } from '../lib/store'

const DAY_TABS = [
  { id: 'all', label: 'Les 2 jours', offsets: [0, 1] },
  { id: 'today', label: "Aujourd'hui", offsets: [0] },
  { id: 'tomorrow', label: 'Demain', offsets: [1] },
]

export default function FixturesView({ apiKey, apiProvider, onOpenMemory }) {
  const { model, stats, memories } = useMemory()
  const [dayTab, setDayTab] = useState('all')
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(false)
  const [warning, setWarning] = useState(null)
  const [source, setSource] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)
  const [selected, setSelected] = useState(null)
  const [league, setLeague] = useState('Tous')
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)
  const [scoreInputs, setScoreInputs] = useState({ h: '', a: '' })

  const dayOffsets = DAY_TABS.find(d => d.id === dayTab)?.offsets || [0, 1]

  const load = async (offsets = dayOffsets) => {
    setLoading(true)
    setWarning(null)
    try {
      const res = await fetchTodayTomorrow({ provider: apiProvider, apiKey, offsets })
      setMatches(res.matches)
      setSource(res.source)
      setWarning(res.warning)
      setLoadedAt(new Date())
    } catch (err) {
      setWarning(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load(dayOffsets)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayTab, apiProvider])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(t)
  }, [toast])

  const memoryByMatch = useMemo(() => {
    const map = {}
    memories.forEach(m => {
      map[m.matchId] = m
    })
    return map
  }, [memories])

  const enriched = useMemo(
    () =>
      matches.map(m => {
        const features = makeFeatures(m)
        const ai = predict(model, features)
        const mem = memoryByMatch[m.id] || (m.id ? memoryByMatch[`${m.id}`] : null)
        return { ...m, features, ai, memory: mem || null }
      }),
    [matches, model, memoryByMatch]
  )

  const leagues = useMemo(() => {
    const set = new Set(enriched.map(m => m.league))
    return ['Tous', ...Array.from(set).sort()]
  }, [enriched])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return enriched.filter(
      m =>
        (league === 'Tous' || m.league === league) &&
        (!q || m.home.toLowerCase().includes(q) || m.away.toLowerCase().includes(q) || m.league.toLowerCase().includes(q))
    )
  }, [enriched, league, query])

  const grouped = useMemo(() => {
    const map = {}
    visible.forEach(m => {
      const key = m.date || 'date'
      if (!map[key]) map[key] = {}
      if (!map[key][m.league]) map[key][m.league] = []
      map[key][m.league].push(m)
    })
    return map
  }, [visible])

  const todayCount = enriched.filter(m => m.date === isoDate(0)).length
  const tomorrowCount = enriched.filter(m => m.date === isoDate(1)).length

  const recordOne = m => {
    const mem = actions.record(m, { source: 'matchs du jour' })
    setToast({ type: 'ok', text: `Prédiction enregistrée en mémoire : ${m.home} – ${m.away}` })
    return mem
  }

  const analyzeAll = () => {
    let n = 0
    visible.forEach(m => {
      if (!memoryByMatch[m.id]) {
        actions.record(m, { source: 'matchs du jour' })
        n++
      }
    })
    setToast({ type: n ? 'ok' : 'info', text: n ? `${n} prédictions ajoutées à la mémoire — l'IA s'entraînera dès les résultats connus.` : 'Tous les matchs affichés sont déjà en mémoire.' })
  }

  const submitScore = () => {
    if (!selected?.memory) return
    const res = actions.resolve(selected.memory.id, scoreInputs.h, scoreInputs.a)
    if (!res) {
      setToast({ type: 'warn', text: 'Renseigne un score valide (deux nombres).' })
      return
    }
    setToast({ type: 'ok', text: res.correct ? '✅ Prédiction validée — le modèle a renforcé ses poids.' : '❌ Erreur enregistrée — le modèle vient d’apprendre.' })
    setScoreInputs({ h: '', a: '' })
  }

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-[24px] font-black flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-sky-600 grid place-items-center"><CalendarDays size={18} /></span>
            Matchs du jour & de demain
            <span className="text-xs bg-[#22c55e] text-black font-black px-2.5 py-1 rounded-full">AUTO</span>
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Récupération automatique du calendrier, prédiction IA de chaque rencontre et mémorisation pour l'apprentissage.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(dayOffsets)}
            disabled={loading}
            className="flex items-center gap-2 bg-white/[0.06] border border-white/10 hover:bg-white/10 px-4 py-2.5 rounded-full text-sm font-bold disabled:opacity-60"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Rafraîchir
          </button>
          <button onClick={analyzeAll} className="flex items-center gap-2 bg-[#22c55e] text-black px-4 py-2.5 rounded-full text-sm font-black hover:bg-[#16a34a]">
            <Brain size={15} /> Tout analyser
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { k: "Aujourd'hui", v: todayCount, sub: isoDate(0), icon: Clock, color: 'from-[#22c55e] to-[#15803d]' },
          { k: 'Demain', v: tomorrowCount, sub: isoDate(1), icon: CalendarDays, color: 'from-sky-500 to-blue-600' },
          { k: 'Compétitions', v: leagues.length - 1, sub: 'ligues détectées', icon: MapPin, color: 'from-violet-500 to-purple-600' },
          { k: 'Précision IA', v: `${stats.accuracy.toFixed(1)}%`, sub: `${stats.resolvedCount} résultats appris`, icon: TrendingUp, color: 'from-yellow-500 to-orange-600' },
        ].map(c => (
          <div key={c.k} className="glass rounded-2xl p-4 relative overflow-hidden">
            <div className={`absolute -right-8 -top-8 w-24 h-24 bg-gradient-to-br ${c.color} opacity-20 blur-2xl rounded-full`} />
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${c.color} grid place-items-center`}><c.icon size={15} /></div>
            <div className="mt-3 text-white/50 text-[11px] font-bold tracking-wide uppercase">{c.k}</div>
            <div className="text-[22px] font-black leading-none mt-0.5">{c.v}</div>
            <div className="text-[11px] text-white/40 truncate">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* toolbar */}
      <div className="glass-strong rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2 justify-between">
          <div className="flex bg-[#111b11] border border-white/10 rounded-full p-1">
            {DAY_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setDayTab(t.id)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-bold transition ${dayTab === t.id ? 'bg-white text-black' : 'text-white/60 hover:text-white'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1.5 bg-white/[0.06] border border-white/10 px-3 py-1.5 rounded-full">
              <Database size={12} className="text-sky-400" />
              {PROVIDERS[apiProvider]?.label || apiProvider}
            </span>
            <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-bold ${source === 'simulation' ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20' : 'bg-[#22c55e]/15 text-[#86efac] border border-[#22c55e]/20'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />
              {source === 'simulation' ? 'Calendrier simulé' : `Live ${source}`}
            </span>
            {loadedAt && <span className="text-white/30 hidden sm:inline">MAJ {loadedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-2">
          <div className="relative flex-1">
            <Target size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Chercher une équipe ou une compétition..."
              className="w-full bg-white/[0.05] border border-white/10 rounded-full pl-9 pr-3 py-2.5 text-sm outline-none placeholder:text-white/30 focus:border-[#22c55e]/50"
            />
          </div>
          <span className="hidden xl:flex items-center gap-1.5 text-[11px] text-white/35 px-2">
            <Brain size={12} /> probas calculées en direct • « Analyser » pour mémoriser
          </span>
          <select
            value={league}
            onChange={e => setLeague(e.target.value)}
            className="bg-white/[0.05] border border-white/10 rounded-full px-3 py-2.5 text-sm outline-none"
          >
            {leagues.map(l => (
              <option key={l} value={l} className="bg-[#0a120a]">{l}</option>
            ))}
          </select>
        </div>
      </div>

      {warning && (
        <div className="bg-amber-500/10 border border-amber-500/25 text-amber-200 rounded-2xl px-4 py-3 text-xs flex gap-2 items-start">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Source de données : </span>
            {warning}
            <button onClick={() => load(dayOffsets)} className="ml-2 underline font-bold">Réessayer</button>
          </div>
        </div>
      )}

      {toast && (
        <div className={`rounded-2xl px-4 py-3 text-sm flex items-center gap-2 border ${toast.type === 'ok' ? 'bg-[#22c55e]/10 border-[#22c55e]/25 text-[#86efac]' : toast.type === 'warn' ? 'bg-red-500/10 border-red-500/25 text-red-300' : 'bg-white/5 border-white/10 text-white/70'}`}>
          <CheckCircle2 size={15} /> {toast.text}
        </div>
      )}

      {loading ? (
        <div className="glass-strong rounded-2xl p-14 text-center">
          <Loader2 size={26} className="animate-spin mx-auto text-[#22c55e]" />
          <div className="mt-3 font-bold">Récupération du calendrier…</div>
          <div className="text-xs text-white/40">Interrogation de {PROVIDERS[apiProvider]?.label} pour {dayOffsets.map(o => isoDate(o)).join(' et ')}</div>
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-strong rounded-2xl p-14 text-center">
          <CalendarDays size={26} className="mx-auto text-white/30" />
          <div className="mt-3 font-bold">Aucun match trouvé</div>
          <div className="text-xs text-white/40">Change de filtre ou rafraîchis les données.</div>
        </div>
      ) : (
        Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, byLeague]) => (
            <div key={date} className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="text-sm font-black">{date === isoDate(0) ? "Aujourd'hui" : date === isoDate(1) ? 'Demain' : formatDay(date)}</div>
                <div className="text-xs text-white/40">{new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
                <div className="flex-1 h-px bg-white/10" />
                <div className="text-xs text-white/40">{Object.values(byLeague).flat().length} matchs</div>
              </div>

              {Object.entries(byLeague).map(([lg, list]) => (
                <div key={lg} className="glass-strong rounded-2xl overflow-hidden">
                  <div className="px-4 py-2.5 bg-white/[0.03] border-b border-white/[0.06] flex items-center gap-2">
                    <Sparkles size={13} className="text-[#22c55e]" />
                    <span className="text-xs font-bold tracking-wide">{lg}</span>
                    <span className="text-[11px] text-white/40">{list.length} rencontres</span>
                  </div>
                  <div className="divide-y divide-white/[0.05]">
                    {list.map(m => (
                      <MatchRow
                        key={m.id}
                        match={m}
                        onOpen={() => { setSelected(m); setScoreInputs({ h: '', a: '' }) }}
                        onRecord={() => recordOne(m)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))
      )}

      {/* model footer */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-white/40 glass rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-[#22c55e]" />
          Mémoire IA : {stats.resolvedCount} résultats appris • modèle gén. {model.generation} • {stats.pendingCount} prédictions en attente
        </div>
        <button onClick={onOpenMemory} className="text-[#22c55e] font-bold flex items-center gap-1">
          Voir la mémoire & l'apprentissage <ChevronRight size={13} />
        </button>
      </div>

      {selected && (
        <MatchModal
          match={selected}
          memory={memoryByMatch[selected.id]}
          scoreInputs={scoreInputs}
          setScoreInputs={setScoreInputs}
          onSubmit={submitScore}
          onClose={() => setSelected(null)}
          onRecord={() => recordOne(selected)}
          model={model}
          stats={stats}
        />
      )}
    </div>
  )
}

function MatchRow({ match, onOpen, onRecord }) {
  const ai = match.ai
  const inMemory = !!match.memory
  return (
    <div className="px-4 py-3 hover:bg-white/[0.03] transition">
      <div className="flex items-center gap-3">
        <div className="w-14 shrink-0 text-center">
          <div className="text-xs font-black">{formatKickoff(match.kickoff)}</div>
          <div className="text-[10px] text-white/30">{match.simulated ? 'simulé' : 'prévu'}</div>
        </div>

        <div className="flex-1 min-w-0">
          <button onClick={onOpen} className="text-left w-full">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold truncate">{match.home}</span>
              <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full text-white/50">{match.homeRating}</span>
              <span className="text-white/30 text-xs">vs</span>
              <span className="text-sm font-bold truncate">{match.away}</span>
              <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full text-white/50">{match.awayRating}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <ProbBar list={ai.list} compact />
              <span className="text-[11px] text-white/40 shrink-0">score IA <b className="text-white/80">{ai.scoreline}</b></span>
            </div>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:block text-right">
            <div className="text-[11px] text-white/40">confiance</div>
            <div className={`text-sm font-black ${ai.confidence > 65 ? 'text-[#22c55e]' : ai.confidence > 50 ? 'text-amber-300' : 'text-white/60'}`}>{ai.confidence.toFixed(0)}%</div>
          </div>
          {inMemory ? (
            <button onClick={onOpen} className="flex items-center gap-1 text-[11px] bg-[#22c55e]/15 border border-[#22c55e]/25 text-[#86efac] px-2.5 py-1.5 rounded-full font-bold">
              <CheckCircle2 size={12} /> En mémoire
            </button>
          ) : (
            <button onClick={onRecord} className="flex items-center gap-1 text-[11px] bg-white text-black px-2.5 py-1.5 rounded-full font-bold hover:bg-[#22c55e]">
              <Zap size={12} /> Analyser
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ProbBar({ list, compact = false }) {
  const colors = ['bg-[#22c55e]', 'bg-white/50', 'bg-sky-400']
  return (
    <div className={`flex items-center gap-1 ${compact ? 'w-[190px]' : 'w-full'}`}>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden flex bg-white/10">
        {list.map((p, i) => (
          <div key={i} className={colors[i]} style={{ width: `${p * 100}%` }} />
        ))}
      </div>
      <span className="text-[10px] font-bold text-white/70 tabular-nums">
        {(list[0] * 100).toFixed(0)}/{(list[1] * 100).toFixed(0)}/{(list[2] * 100).toFixed(0)}
      </span>
    </div>
  )
}

function MatchModal({ match, memory, scoreInputs, setScoreInputs, onSubmit, onClose, onRecord, model, stats }) {
  const ai = predict(model, match.features || makeFeatures(match))
  const resolved = memory?.outcome
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full max-w-[680px] bg-[#0a120a] border border-white/10 rounded-[24px] max-h-[92vh] overflow-y-auto">
        <div className="p-5 border-b border-white/[0.07] flex items-start justify-between">
          <div>
            <div className="text-[11px] font-bold tracking-wide text-white/40">{match.league} • {formatDay(match.kickoff)} {formatKickoff(match.kickoff)}</div>
            <div className="text-lg font-black mt-1">{match.home} <span className="text-white/30 font-medium">vs</span> {match.away}</div>
            <div className="text-xs text-white/50 mt-0.5">Ratings IA {match.homeRating} / {match.awayRating} • formes {match.homeForm} / {match.awayForm}</div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/10 grid place-items-center"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {OUTCOMES.map((o, i) => (
              <div key={o} className={`rounded-2xl p-3 text-center border ${ai.pick === o ? 'bg-[#22c55e]/15 border-[#22c55e]/40' : 'bg-white/[0.04] border-white/10'}`}>
                <div className="text-[11px] text-white/50 font-bold">{o === 'home' ? match.homeShort : o === 'away' ? match.awayShort : 'NUL'} · {OUTCOME_SHORT[o]}</div>
                <div className="text-xl font-black mt-1">{(ai.list[i] * 100).toFixed(1)}%</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3 text-center">
              <div className="text-[10px] font-bold text-white/40">SCORE IA</div>
              <div className="text-lg font-black">{ai.scoreline}</div>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3 text-center">
              <div className="text-[10px] font-bold text-white/40">xG ATTENDUS</div>
              <div className="text-lg font-black">{ai.lambdaHome.toFixed(2)} – {ai.lambdaAway.toFixed(2)}</div>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3 text-center">
              <div className="text-[10px] font-bold text-white/40">CONFIANCE</div>
              <div className="text-lg font-black text-[#22c55e]">{ai.confidence.toFixed(0)}%</div>
            </div>
          </div>

          <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-4">
            <div className="text-xs font-bold text-white/60 flex items-center gap-2"><Info size={13} /> Contribution des facteurs au pronostic</div>
            <div className="mt-3 space-y-2">
              {Object.entries(ai.contributions).map(([k, v]) => {
                const label = { rating: 'Niveau / rating', form: 'Forme récente', xg: 'xG créés', home: 'Avantage terrain' }[k]
                const mag = Math.min(100, (Math.abs(v) / 2.2) * 100)
                return (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-28 text-[11px] text-white/60">{label}</span>
                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className={`h-full ${v >= 0 ? 'bg-[#22c55e]' : 'bg-red-500'}`} style={{ width: `${mag}%` }} />
                    </div>
                    <span className={`text-[11px] font-bold w-12 text-right ${v >= 0 ? 'text-[#22c55e]' : 'text-red-400'}`}>{v >= 0 ? '+' : ''}{v.toFixed(2)}</span>
                  </div>
                )
              })}
            </div>
            <div className="text-[10px] text-white/30 mt-2">Poids appris : rating {model.weights.rating.toFixed(2)} • forme {model.weights.form.toFixed(2)} • xG {model.weights.xg.toFixed(2)} • terrain {model.weights.home.toFixed(2)} • biais nul {model.drawBase.toFixed(2)} (précision {stats.accuracy.toFixed(1)}%)</div>
          </div>

          {!memory ? (
            <button onClick={onRecord} className="w-full bg-[#22c55e] text-black font-black py-3 rounded-full flex items-center justify-center gap-2">
              <Brain size={16} /> Enregistrer cette prédiction en mémoire
            </button>
          ) : resolved ? (
            <div className={`rounded-2xl p-4 border ${memory.correct ? 'bg-[#22c55e]/10 border-[#22c55e]/25' : 'bg-red-500/10 border-red-500/25'}`}>
              <div className="text-sm font-bold flex items-center gap-2">
                {memory.correct ? <CheckCircle2 size={15} className="text-[#22c55e]" /> : <AlertCircle size={15} className="text-red-400" />}
                Résultat enregistré : {memory.actualScore} — {OUTCOME_LABEL[memory.outcome]}
              </div>
              <div className="text-xs text-white/60 mt-1">Brier {memory.brier?.toFixed(3)} • le modèle a déjà intégré cette leçon ({memory.confidence.toFixed(0)}% de confiance au moment du prono).</div>
            </div>
          ) : (
            <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
              <div className="text-sm font-bold flex items-center gap-2"><Zap size={14} className="text-[#22c55e]" /> Résultat réel — faire apprendre l'IA</div>
              <div className="text-xs text-white/50 mt-1">Saisis le score final : le modèle ajuste immédiatement ses poids et enregistre la leçon.</div>
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number" min="0" max="15" value={scoreInputs.h}
                  onChange={e => setScoreInputs(s => ({ ...s, h: e.target.value }))}
                  placeholder={match.homeShort}
                  className="w-16 bg-white/[0.06] border border-white/10 rounded-xl px-2 py-2.5 text-center font-black outline-none"
                />
                <span className="text-white/40">–</span>
                <input
                  type="number" min="0" max="15" value={scoreInputs.a}
                  onChange={e => setScoreInputs(s => ({ ...s, a: e.target.value }))}
                  placeholder={match.awayShort}
                  className="w-16 bg-white/[0.06] border border-white/10 rounded-xl px-2 py-2.5 text-center font-black outline-none"
                />
                <button onClick={onSubmit} className="flex-1 bg-[#22c55e] text-black font-black py-2.5 rounded-xl text-sm">Enregistrer & apprendre</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

import React, { useMemo, useRef, useState } from 'react'
import {
  Brain, BrainCircuit, TrendingUp, TrendingDown, CheckCircle2, AlertCircle, RefreshCw,
  Download, Upload, Trash2, Sparkles, Zap, Search, Target, Activity, Layers,
  GraduationCap, ChevronDown, ChevronUp, Info, Flame,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, BarChart, Bar, Cell, ReferenceLine,
} from 'recharts'
import { FEATURE_LABEL, OUTCOMES, OUTCOME_LABEL, OUTCOME_SHORT } from '../lib/model'
import { actions, useMemory } from '../lib/store'

const card = 'glass-strong rounded-[22px]'

export default function MemoryView({ onOpenFixtures }) {
  const { state, model, stats, lessons, autoLearn } = useMemory()
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [consolidating, setConsolidating] = useState(false)
  const [consolidation, setConsolidation] = useState(null)
  const [toast, setToast] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [showLessons, setShowLessons] = useState(true)
  const fileRef = useRef(null)

  const memories = state.memories
  const resolved = stats.resolved

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...memories]
      .reverse()
      .filter(m => {
        if (filter === 'resolved' && !m.outcome) return false
        if (filter === 'pending' && m.outcome) return false
        if (filter === 'errors' && !(m.outcome && !m.correct)) return false
        if (!q) return true
        return (
          m.home.toLowerCase().includes(q) ||
          m.away.toLowerCase().includes(q) ||
          (m.league || '').toLowerCase().includes(q)
        )
      })
      .slice(0, 80)
  }, [memories, filter, query])

  const runConsolidation = () => {
    setConsolidating(true)
    setConsolidation(null)
    setTimeout(() => {
      const res = actions.consolidateNow()
      setConsolidating(false)
      if (!res) {
        setToast({ type: 'warn', text: 'Aucun résultat en mémoire à consolider pour le moment.' })
        return
      }
      setConsolidation(res)
      setToast({
        type: 'ok',
        text: `Consolidation terminée : ${res.before.accuracy.toFixed(1)}% → ${res.after.accuracy.toFixed(1)}% de précision (gén. ${res.generation}).`,
      })
    }, 700)
  }

  const doSimulate = () => {
    const n = actions.simulateResults(8)
    setToast({ type: 'ok', text: `${n} résultats d'entraînement ajoutés — la courbe d'apprentissage est mise à jour.` })
  }

  const handleExport = () => {
    const data = actions.exportMemory()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `footballai-memoire-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setToast({ type: 'ok', text: 'Mémoire exportée (modèle + prédictions + leçons).' })
  }

  const handleImport = async e => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const ok = actions.importMemory(text)
    setToast(ok ? { type: 'ok', text: 'Mémoire importée et modèle restauré.' } : { type: 'warn', text: 'Fichier invalide : mémoire inchangée.' })
    e.target.value = ''
  }

  const delta = stats.progress
  const pendingCount = stats.pendingCount

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-wrap gap-3 items-start justify-between">
        <div>
          <h1 className="text-[24px] font-black flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 grid place-items-center"><BrainCircuit size={18} /></span>
            Mémoire & Apprentissage
            <span className="text-xs bg-violet-600 text-white font-black px-2.5 py-1 rounded-full">GÉN. {model.generation}</span>
          </h1>
          <p className="text-sm text-white/50 mt-1 max-w-[720px]">
            Chaque prédiction est mémorisée. Chaque résultat saisi déclenche une correction des poids (descente de gradient) : l'IA apprend de ses erreurs et s'améliore en continu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => actions.setAutoLearn(!autoLearn)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-full text-xs font-bold border ${autoLearn ? 'bg-[#22c55e]/15 border-[#22c55e]/30 text-[#86efac]' : 'bg-white/5 border-white/10 text-white/60'}`}
          >
            <span className={`w-2 h-2 rounded-full ${autoLearn ? 'bg-[#22c55e] animate-pulse' : 'bg-white/40'}`} />
            Apprentissage continu {autoLearn ? 'ON' : 'OFF'}
          </button>
          <button onClick={handleExport} className="p-2.5 rounded-full bg-white/[0.06] border border-white/10" title="Exporter la mémoire"><Download size={15} /></button>
          <button onClick={() => fileRef.current?.click()} className="p-2.5 rounded-full bg-white/[0.06] border border-white/10" title="Importer une mémoire"><Upload size={15} /></button>
          <input ref={fileRef} type="file" accept="application/json" onChange={handleImport} className="hidden" />
          <button
            onClick={() => { actions.resetMemories({ reseed: true }); setToast({ type: 'ok', text: 'Mémoire réinitialisée avec le jeu d’amorçage.' }) }}
            className="p-2.5 rounded-full bg-white/[0.06] border border-white/10 hover:bg-red-500/20"
            title="Réinitialiser"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {toast && (
        <div className={`rounded-2xl px-4 py-3 text-sm flex items-center gap-2 border ${toast.type === 'ok' ? 'bg-[#22c55e]/10 border-[#22c55e]/25 text-[#86efac]' : 'bg-amber-500/10 border-amber-500/25 text-amber-200'}`}>
          <CheckCircle2 size={15} /> {toast.text}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { k: 'Prédictions', v: stats.total, sub: `${resolved.length} résolues`, icon: Layers, grad: 'from-sky-500 to-blue-600' },
          { k: 'Précision', v: `${stats.accuracy.toFixed(1)}%`, sub: delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(0)} pts sur 10` : 'en construction', icon: Target, grad: 'from-[#22c55e] to-[#15803d]', trend: delta },
          { k: 'Brier', v: stats.brier.toFixed(3), sub: '0 = parfait', icon: Activity, grad: 'from-violet-500 to-purple-600' },
          { k: 'Erreurs apprises', v: resolved.filter(m => !m.correct).length, sub: `${lessons.length} leçons`, icon: GraduationCap, grad: 'from-orange-500 to-red-600' },
          { k: 'En attente', v: pendingCount, sub: 'résultats à saisir', icon: RefreshCw, grad: 'from-yellow-500 to-orange-600' },
        ].map(c => (
          <div key={c.k} className="glass rounded-2xl p-4 relative overflow-hidden">
            <div className={`absolute -right-8 -top-8 w-24 h-24 bg-gradient-to-br ${c.grad} opacity-20 blur-2xl rounded-full`} />
            <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${c.grad} grid place-items-center`}><c.icon size={15} /></div>
            <div className="mt-3 text-[11px] font-bold tracking-wide text-white/50 uppercase">{c.k}</div>
            <div className="text-[22px] font-black leading-none mt-0.5 flex items-center gap-1">
              {c.v}
              {c.trend != null && c.trend !== 0 && (c.trend > 0 ? <TrendingUp size={14} className="text-[#22c55e]" /> : <TrendingDown size={14} className="text-red-400" />)}
            </div>
            <div className="text-[11px] text-white/40">{c.sub}</div>
          </div>
        ))}
      </div>

      {/* courbe + poids */}
      <div className="grid lg:grid-cols-[1.35fr_0.65fr] gap-5">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-bold flex items-center gap-2"><TrendingUp size={16} className="text-[#22c55e]" /> Courbe d'apprentissage</h3>
            <div className="flex gap-3 text-[11px] text-white/50">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#22c55e]" /> précision glissante (8)</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-violet-400" /> Brier ×100</span>
            </div>
          </div>
          <div className="h-[230px] mt-3">
            {stats.curve.length < 2 ? (
              <div className="h-full grid place-items-center text-center text-sm text-white/40">
                <div>
                  <Brain size={22} className="mx-auto mb-2 text-white/30" />
                  Enregistre au moins 2 résultats pour tracer la progression.
                </div>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.curve.map(c => ({ ...c, brier100: +(c.brier * 100).toFixed(1) }))}>
                  <CartesianGrid stroke="#ffffff0d" vertical={false} />
                  <XAxis dataKey="n" stroke="#ffffff25" fontSize={10} tickLine={false} />
                  <YAxis yAxisId="l" domain={[0, 100]} stroke="#ffffff25" fontSize={10} tickLine={false} width={30} />
                  <YAxis yAxisId="r" orientation="right" stroke="#ffffff25" fontSize={10} tickLine={false} width={30} />
                  <Tooltip
                    contentStyle={{ background: '#0a120a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontSize: 12 }}
                    labelFormatter={v => `Après ${v} résultats`}
                  />
                  <ReferenceLine yAxisId="l" y={50} stroke="#ffffff20" strokeDasharray="4 4" />
                  <Line yAxisId="l" type="monotone" dataKey="acc" name="Précision %" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="brier100" name="Brier ×100" stroke="#a78bfa" strokeWidth={1.6} dot={false} strokeDasharray="4 3" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="bg-white/[0.04] border border-white/10 rounded-xl p-2.5 text-center">
              <div className="text-[10px] text-white/40 font-bold">10 DERNIERS</div>
              <div className="font-black text-sm">{stats.lastAcc != null ? `${stats.lastAcc.toFixed(0)}%` : '—'}</div>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-xl p-2.5 text-center">
              <div className="text-[10px] text-white/40 font-bold">10 PRÉCÉDENTS</div>
              <div className="font-black text-sm">{stats.prevAcc != null ? `${stats.prevAcc.toFixed(0)}%` : '—'}</div>
            </div>
            <div className="bg-white/[0.04] border border-white/10 rounded-xl p-2.5 text-center">
              <div className="text-[10px] text-white/40 font-bold">ÉPOCHS</div>
              <div className="font-black text-sm">{model.epochs || 0}</div>
            </div>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-bold flex items-center gap-2"><Brain size={16} className="text-violet-400" /> Poids appris</h3>
          <p className="text-[11px] text-white/40 mt-1">Mis à jour à chaque résultat. Plus la barre est longue, plus le facteur pèse.</p>
          <div className="mt-4 space-y-3">
            {Object.entries(model.weights).map(([k, v]) => (
              <div key={k}>
                <div className="flex justify-between text-[11px]"><span className="text-white/60">{FEATURE_LABEL[k]}</span><span className="font-black tabular-nums">{v.toFixed(2)}</span></div>
                <div className="mt-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-[#22c55e] rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (v / 3.2) * 100)}%` }} />
                </div>
              </div>
            ))}
            <div>
              <div className="flex justify-between text-[11px]"><span className="text-white/60">Biais match nul (drawBase)</span><span className="font-black tabular-nums">{model.drawBase.toFixed(2)}</span></div>
              <div className="mt-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-amber-400 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (model.drawBase / 1.5) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-[11px]"><span className="text-white/60">Biais domicile</span><span className="font-black tabular-nums">{model.bias.toFixed(2)}</span></div>
              <div className="mt-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-sky-400 rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (Math.abs(model.bias) / 0.9) * 100)}%` }} />
              </div>
            </div>
          </div>
          <div className="mt-4 bg-violet-600/10 border border-violet-500/20 rounded-xl p-3 text-[11px] text-white/70 flex gap-2">
            <Info size={13} className="text-violet-300 shrink-0 mt-0.5" />
            <span>Température {model.temperature.toFixed(2)} • {model.samples} pas d'entraînement • MAJ {model.updatedAt ? new Date(model.updatedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
          </div>
        </div>
      </div>

      {/* insights */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2"><Sparkles size={16} className="text-yellow-400" /> Ce que l'IA a compris d'elle-même</h3>
          <span className="text-[11px] bg-white/10 px-2.5 py-1 rounded-full">{stats.insights.length} insights</span>
        </div>
        <div className="mt-4 grid md:grid-cols-2 gap-3">
          {stats.insights.map((ins, i) => (
            <div key={i} className={`rounded-2xl p-3.5 border ${ins.type === 'good' ? 'bg-[#22c55e]/8 border-[#22c55e]/20' : ins.type === 'warn' ? 'bg-orange-500/8 border-orange-500/20' : 'bg-white/[0.04] border-white/10'}`}>
              <div className={`text-sm font-bold flex items-center gap-2 ${ins.type === 'good' ? 'text-[#86efac]' : ins.type === 'warn' ? 'text-orange-300' : 'text-white'}`}>
                {ins.type === 'good' ? <CheckCircle2 size={14} /> : ins.type === 'warn' ? <AlertCircle size={14} /> : <Info size={14} />}
                {ins.title}
              </div>
              <div className="text-xs text-white/60 mt-1 leading-relaxed">{ins.text}</div>
            </div>
          ))}
        </div>
      </div>

      {/* calibration + répartition */}
      <div className="grid lg:grid-cols-2 gap-5">
        <div className={`${card} p-5`}>
          <h3 className="font-bold flex items-center gap-2"><Target size={16} className="text-sky-400" /> Calibration par niveau de confiance</h3>
          <div className="h-[190px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.buckets}>
                <CartesianGrid stroke="#ffffff0d" vertical={false} />
                <XAxis dataKey="label" stroke="#ffffff25" fontSize={10} tickLine={false} />
                <YAxis domain={[0, 100]} stroke="#ffffff25" fontSize={10} tickLine={false} width={28} />
                <Tooltip contentStyle={{ background: '#0a120a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, fontSize: 12 }} formatter={v => [`${v}%`, 'Réussite']} />
                <Bar dataKey="acc" radius={[6, 6, 0, 0]}>
                  {stats.buckets.map((b, i) => (
                    <Cell key={i} fill={b.acc == null ? '#ffffff15' : b.acc >= 65 ? '#22c55e' : b.acc >= 45 ? '#facc15' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-between text-[11px] text-white/40 px-1">
            {stats.buckets.map(b => <span key={b.label}>{b.n} cas</span>)}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-bold flex items-center gap-2"><Activity size={16} className="text-[#22c55e]" /> Réussite par type de pronostic</h3>
          <div className="mt-4 space-y-3">
            {stats.byPick.map(p => (
              <div key={p.pick} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                <div className="flex justify-between text-xs">
                  <span className="font-bold">{OUTCOME_SHORT[p.pick]} · {p.label}</span>
                  <span className="text-white/50">{p.n} cas • <b className="text-white">{p.acc != null ? `${p.acc}%` : '—'}</b></span>
                </div>
                <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${p.pick === 'home' ? 'bg-[#22c55e]' : p.pick === 'draw' ? 'bg-amber-400' : 'bg-sky-400'}`} style={{ width: `${p.acc || 0}%` }} />
                </div>
              </div>
            ))}
          </div>
          {stats.leagues.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-bold text-white/50 mb-2">PAR COMPÉTITION</div>
              <div className="space-y-1.5">
                {stats.leagues.slice(0, 4).map(l => (
                  <div key={l.league} className="flex items-center justify-between text-[11px]">
                    <span className="text-white/60 truncate">{l.league}</span>
                    <span className="text-white/40">{l.n} matchs • <b className={l.acc >= 60 ? 'text-[#22c55e]' : 'text-white/70'}>{l.acc}%</b></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* consolidation */}
      <div className="rounded-[22px] p-5 border border-violet-500/25 bg-gradient-to-br from-violet-600/15 via-[#0d1a0d] to-[#0a120a]">
        <div className="flex flex-wrap items-center gap-4 justify-between">
          <div className="max-w-[560px]">
            <h3 className="font-black flex items-center gap-2"><GraduationCap size={18} className="text-violet-300" /> Consolidation de la mémoire</h3>
            <p className="text-sm text-white/60 mt-1">
              Repasse 5 epochs sur les {resolved.length} résultats mémorisés pour recaler l'ensemble des poids. C'est l'équivalent d'un entraînement nocturne : le modèle gagne une génération.
            </p>
            {consolidation && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="bg-black/30 border border-white/10 rounded-full px-2.5 py-1">Précision {consolidation.before.accuracy.toFixed(1)}% → <b className="text-[#22c55e]">{consolidation.after.accuracy.toFixed(1)}%</b></span>
                <span className="bg-black/30 border border-white/10 rounded-full px-2.5 py-1">Brier {consolidation.before.brier.toFixed(3)} → <b className="text-violet-300">{consolidation.after.brier.toFixed(3)}</b></span>
                <span className="bg-black/30 border border-white/10 rounded-full px-2.5 py-1">Génération {consolidation.generation}</span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={doSimulate} className="px-4 py-3 rounded-full bg-white/[0.07] border border-white/10 text-sm font-bold flex items-center gap-2 hover:bg-white/10">
              <Flame size={15} className="text-orange-400" /> Ajouter 8 résultats démo
            </button>
            <button
              onClick={runConsolidation}
              disabled={consolidating || !resolved.length}
              className="px-5 py-3 rounded-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-black flex items-center gap-2"
            >
              {consolidating ? <><RefreshCw size={15} className="animate-spin" /> Entraînement…</> : <><Zap size={15} /> Lancer la consolidation</>}
            </button>
          </div>
        </div>
      </div>

      {/* leçons */}
      <div className={`${card} p-5`}>
        <button onClick={() => setShowLessons(s => !s)} className="w-full flex items-center justify-between">
          <h3 className="font-bold flex items-center gap-2"><GraduationCap size={16} className="text-[#22c55e]" /> Journal des leçons ({lessons.length})</h3>
          {showLessons ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
        </button>
        {showLessons && (
          <div className="mt-4 space-y-2 max-h-[320px] overflow-y-auto pr-1">
            {lessons.length === 0 && <div className="text-sm text-white/40 text-center py-6">Aucune leçon pour l'instant. Saisis un résultat depuis « Matchs du jour ».</div>}
            {lessons.map(l => (
              <div key={l.id} className={`rounded-xl border px-3 py-2.5 ${l.correct ? 'bg-[#22c55e]/6 border-[#22c55e]/15' : 'bg-red-500/6 border-red-500/15'}`}>
                <div className="flex items-center gap-2 text-[11px] text-white/40">
                  {l.correct ? <CheckCircle2 size={12} className="text-[#22c55e]" /> : <AlertCircle size={12} className="text-red-400" />}
                  <span className="font-bold text-white/70">{l.match}</span>
                  <span>• {new Date(l.at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} {new Date(l.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
                  {l.seeded && <span className="bg-white/10 px-1.5 py-0.5 rounded-full">amorçage</span>}
                </div>
                <div className="text-xs text-white/65 mt-1 leading-relaxed">{l.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* historique */}
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <h3 className="font-bold flex items-center gap-2"><Layers size={16} className="text-sky-400" /> Historique des prédictions ({stats.total})</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher…" className="bg-white/[0.06] border border-white/10 rounded-full pl-8 pr-3 py-1.5 text-xs outline-none w-[160px]" />
            </div>
            <div className="flex bg-[#111b11] border border-white/10 rounded-full p-1">
              {[
                { id: 'all', l: 'Tout' },
                { id: 'pending', l: 'En attente' },
                { id: 'resolved', l: 'Résolues' },
                { id: 'errors', l: 'Erreurs' },
              ].map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)} className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${filter === f.id ? 'bg-white text-black' : 'text-white/60'}`}>{f.l}</button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 divide-y divide-white/[0.06] max-h-[460px] overflow-y-auto">
          {filtered.length === 0 && <div className="text-sm text-white/40 text-center py-8">Aucune prédiction dans ce filtre.</div>}
          {filtered.map(m => (
            <div key={m.id} className="py-2.5">
              <div className="flex items-center gap-3">
                <div className="w-10 text-center shrink-0">
                  <div className="text-[10px] font-bold text-white/40">{m.at ? new Date(m.at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—'}</div>
                  <div className="text-[9px] text-white/25">{m.source === 'amorçage' ? 'seed' : m.source === 'matchs du jour' ? 'live' : m.source?.slice(0, 6) || '—'}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold truncate">{m.home} <span className="text-white/30">–</span> {m.away}</div>
                  <div className="text-[10px] text-white/40 truncate">{m.league} • {m.pick ? OUTCOME_LABEL[m.pick] : '—'} à {m.confidence?.toFixed(0)}% • score IA {m.scoreline}</div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  {m.outcome ? (
                    <>
                      <div className="text-right">
                        <div className="text-[11px] font-black tabular-nums">{m.actualScore}</div>
                        <div className={`text-[9px] font-bold ${m.correct ? 'text-[#22c55e]' : 'text-red-400'}`}>Brier {m.brier?.toFixed(2)}</div>
                      </div>
                      <div className={`w-7 h-7 rounded-full grid place-items-center ${m.correct ? 'bg-[#22c55e] text-black' : 'bg-red-500 text-white'}`}>
                        {m.correct ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-1">
                      {OUTCOMES.map(o => (
                        <button
                          key={o}
                          onClick={() => {
                            const res = actions.resolveQuick(m.id, o)
                            setToast(res ? { type: 'ok', text: `Résultat ${OUTCOME_LABEL[o]} enregistré — modèle mis à jour.` } : { type: 'warn', text: 'Impossible d’enregistrer ce résultat.' })
                          }}
                          className="w-7 h-7 rounded-lg bg-white/[0.07] border border-white/10 hover:bg-[#22c55e] hover:text-black text-[11px] font-black"
                          title={`Marquer ${OUTCOME_LABEL[o]}`}
                        >
                          {OUTCOME_SHORT[o]}
                        </button>
                      ))}
                      <button onClick={() => setExpanded(expanded === m.id ? null : m.id)} className="w-7 h-7 rounded-lg bg-white/[0.07] border border-white/10 grid place-items-center">
                        {expanded === m.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {expanded === m.id && !m.outcome && (
                <div className="mt-2 ml-13 bg-white/[0.03] border border-white/10 rounded-xl p-3 text-[11px] text-white/60">
                  Facteurs : rating {m.features?.rating?.toFixed(2)} • forme {m.features?.form?.toFixed(2)} • xG {m.features?.xg?.toFixed(2)} • terrain +1.00.
                  Clique sur 1, N ou 2 pour saisir le résultat réel et déclencher l'apprentissage.
                </div>
              )}
            </div>
          ))}
        </div>

        {pendingCount > 0 && (
          <div className="mt-3 flex items-center justify-between bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2 text-[11px] text-amber-200">
            <span>{pendingCount} prédiction(s) attendent un résultat. Chaque saisie améliore le modèle.</span>
            <button onClick={onOpenFixtures} className="font-bold underline">Ouvrir les matchs</button>
          </div>
        )}
      </div>
    </div>
  )
}

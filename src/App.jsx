import React, { useState, useEffect, useRef } from 'react'
import {
  LayoutDashboard, Zap, MessageCircle, MapPinned, Radio, Search, Settings, Trophy,
  TrendingUp, Brain, Target, Shield, Activity, Clock, Users, BarChart3, Sparkles,
  ChevronRight, Play, Pause, RotateCcw, Send, Bot, User, Flame, Eye, Layers,
  Gauge, Crosshair, Hexagon, Plus, X, Check, Star, ArrowUpRight, Timer, Flag,
  Video, Upload, Film, Crown, Swords, Database, Key, Link2, Wifi, Cpu, FileVideo,
  DollarSign, Trash2, Wand2, GitCompare, AlertCircle, CheckCircle2, ExternalLink
} from 'lucide-react'
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, Cell } from 'recharts'

// --- DATA ---
const TEAMS = [
  { id: 'psg', name: 'Paris SG', short: 'PSG', rating: 88, form: 'WWWDW', color: '#004170', logo: '🔵' },
  { id: 'real', name: 'Real Madrid', short: 'RMA', rating: 92, form: 'WWWWL', color: '#fff', logo: '⚪' },
  { id: 'city', name: 'Man City', short: 'MCI', rating: 91, form: 'WDWWW', color: '#6CABDD', logo: '🩵' },
  { id: 'barca', name: 'FC Barcelona', short: 'BAR', rating: 87, form: 'WWLWW', color: '#A50044', logo: '🔴' },
  { id: 'bayern', name: 'Bayern Munich', short: 'FCB', rating: 89, form: 'WWWWL', color: '#DC052D', logo: '🔴' },
  { id: 'arsenal', name: 'Arsenal', short: 'ARS', rating: 86, form: 'WWWDW', color: '#EF0107', logo: '🔴' },
  { id: 'inter', name: 'Inter Milan', short: 'INT', rating: 85, form: 'WLWWW', color: '#0068A8', logo: '🔵' },
  { id: 'liverpool', name: 'Liverpool', short: 'LIV', rating: 88, form: 'WDWLW', color: '#C8102E', logo: '🔴' },
]

const PLAYERS = [
  { id: 1, name: 'Kylian Mbappé', team: 'Real Madrid', pos: 'ATT', age: 26, value: 180, valueStr: '180M€', rating: 92, pace: 96, shoot: 90, pass: 80, dribble: 93, defend: 35, physical: 78, goals: 28, assists: 7, img: 'https://i.pravatar.cc/200?img=12' },
  { id: 2, name: 'Erling Haaland', team: 'Man City', pos: 'ATT', age: 24, value: 200, valueStr: '200M€', rating: 91, pace: 89, shoot: 95, pass: 65, dribble: 80, defend: 30, physical: 92, goals: 27, assists: 4, img: 'https://i.pravatar.cc/200?img=14' },
  { id: 3, name: 'Jude Bellingham', team: 'Real Madrid', pos: 'MIL', age: 21, value: 150, valueStr: '150M€', rating: 90, pace: 78, shoot: 82, pass: 88, dribble: 86, defend: 78, physical: 85, goals: 12, assists: 11, img: 'https://i.pravatar.cc/200?img=15' },
  { id: 4, name: 'Pedri', team: 'FC Barcelona', pos: 'MIL', age: 22, value: 110, valueStr: '110M€', rating: 88, pace: 76, shoot: 70, pass: 92, dribble: 90, defend: 68, physical: 65, goals: 5, assists: 14, img: 'https://i.pravatar.cc/200?img=16' },
  { id: 5, name: 'William Saliba', team: 'Arsenal', pos: 'DEF', age: 23, value: 85, valueStr: '85M€', rating: 87, pace: 80, shoot: 40, pass: 78, dribble: 70, defend: 90, physical: 88, goals: 2, assists: 1, img: 'https://i.pravatar.cc/200?img=32' },
  { id: 6, name: 'Bukayo Saka', team: 'Arsenal', pos: 'ATT', age: 23, value: 130, valueStr: '130M€', rating: 88, pace: 85, shoot: 82, pass: 84, dribble: 88, defend: 55, physical: 72, goals: 15, assists: 12, img: 'https://i.pravatar.cc/200?img=33' },
  { id: 7, name: 'Rodri', team: 'Man City', pos: 'MIL', age: 28, value: 100, valueStr: '100M€', rating: 89, pace: 70, shoot: 68, pass: 90, dribble: 82, defend: 88, physical: 84, goals: 6, assists: 8, img: 'https://i.pravatar.cc/200?img=18' },
  { id: 8, name: 'Vinicius Jr', team: 'Real Madrid', pos: 'ATT', age: 24, value: 170, valueStr: '170M€', rating: 91, pace: 94, shoot: 84, pass: 78, dribble: 92, defend: 32, physical: 76, goals: 22, assists: 10, img: 'https://i.pravatar.cc/200?img=20' },
]

const FANTASY_POOL = [...PLAYERS,
  { id: 9, name: 'Gianluigi Donnarumma', team: 'Paris SG', pos: 'GARD', age: 25, value: 45, valueStr: '45M€', rating: 87, pace: 50, shoot: 20, pass: 65, dribble: 40, defend: 88, physical: 85, goals: 0, assists: 0, img: 'https://i.pravatar.cc/200?img=53' },
  { id: 10, name: 'Achraf Hakimi', team: 'Paris SG', pos: 'DEF', age: 26, value: 70, valueStr: '70M€', rating: 86, pace: 92, shoot: 60, pass: 78, dribble: 82, defend: 80, physical: 82, goals: 4, assists: 7, img: 'https://i.pravatar.cc/200?img=65' },
  { id: 11, name: 'Florian Wirtz', team: 'Bayer Leverkusen', pos: 'MIL', age: 21, value: 120, valueStr: '120M€', rating: 87, pace: 82, shoot: 78, pass: 89, dribble: 90, defend: 55, physical: 68, goals: 11, assists: 13, img: 'https://i.pravatar.cc/200?img=68' },
  { id: 12, name: 'Jamal Musiala', team: 'Bayern Munich', pos: 'MIL', age: 21, value: 115, valueStr: '115M€', rating: 88, pace: 84, shoot: 75, pass: 85, dribble: 93, defend: 52, physical: 70, goals: 10, assists: 9, img: 'https://i.pravatar.cc/200?img=69' },
]

const FORMATIONS = {
  '4-3-3': [{ x: 50, y: 90, n: 'GK' }, { x: 15, y: 72, n: 'LB' }, { x: 35, y: 75, n: 'CB' }, { x: 65, y: 75, n: 'CB' }, { x: 85, y: 72, n: 'RB' }, { x: 30, y: 50, n: 'CM' }, { x: 50, y: 58, n: 'CDM' }, { x: 70, y: 50, n: 'CM' }, { x: 20, y: 22, n: 'LW' }, { x: 50, y: 15, n: 'ST' }, { x: 80, y: 22, n: 'RW' }],
  '4-2-3-1': [{ x: 50, y: 90, n: 'GK' }, { x: 15, y: 72, n: 'LB' }, { x: 35, y: 75, n: 'CB' }, { x: 65, y: 75, n: 'CB' }, { x: 85, y: 72, n: 'RB' }, { x: 38, y: 58, n: 'CDM' }, { x: 62, y: 58, n: 'CDM' }, { x: 25, y: 35, n: 'LW' }, { x: 50, y: 32, n: 'CAM' }, { x: 75, y: 35, n: 'RW' }, { x: 50, y: 15, n: 'ST' }],
  '3-5-2': [{ x: 50, y: 90, n: 'GK' }, { x: 30, y: 72, n: 'CB' }, { x: 50, y: 75, n: 'CB' }, { x: 70, y: 72, n: 'CB' }, { x: 15, y: 45, n: 'LM' }, { x: 35, y: 50, n: 'CM' }, { x: 50, y: 55, n: 'CDM' }, { x: 65, y: 50, n: 'CM' }, { x: 85, y: 45, n: 'RM' }, { x: 38, y: 18, n: 'ST' }, { x: 62, y: 18, n: 'ST' }],
}

export default function App() {
  const [active, setActive] = useState('dashboard')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [enabled, setEnabled] = useState({
    dashboard: true, predictor: true, chat: true, tactics: true, live: true, scout: true, video: true, fantasy: true, versus: true, api: true
  })
  const [homeTeam, setHomeTeam] = useState(TEAMS[1])
  const [awayTeam, setAwayTeam] = useState(TEAMS[2])
  const [prediction, setPrediction] = useState(null)
  const [predLoading, setPredLoading] = useState(false)
  const [chatMsgs, setChatMsgs] = useState([
    { role: 'bot', text: 'Salut ! Je suis ton assistant FootballAI ⚽️\nPose-moi n\'importe quelle question : tactique, mercato, pronos, stats...' },
  ])
  const [chatInput, setChatInput] = useState('')
  const [chatTyping, setChatTyping] = useState(false)
  const [formation, setFormation] = useState('4-3-3')
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [liveMatches, setLiveMatches] = useState([
    { id: 1, home: 'PSG', away: 'Marseille', hScore: 2, aScore: 1, minute: 67, status: 'live', xgH: 1.8, xgA: 0.9, events: ['⚽ Dembélé 12’', '⚽ Mbappé 44’', '🟨 Hakimi 58’'] },
    { id: 2, home: 'Real Madrid', away: 'Barcelona', hScore: 1, aScore: 1, minute: 54, status: 'live', xgH: 1.2, xgA: 1.4, events: ['⚽ Vinicius 23’', '⚽ Yamal 41’'] },
    { id: 3, home: 'Man City', away: 'Arsenal', hScore: 0, aScore: 0, minute: 33, status: 'live', xgH: 0.6, xgA: 0.4, events: ['🟨 Rodri 15’'] },
    { id: 4, home: 'Bayern', away: 'Dortmund', hScore: 3, aScore: 0, minute: 78, status: 'live', xgH: 2.4, xgA: 0.5, events: ['⚽ Kane 9’', '⚽ Kane 34’', '⚽ Musiala 61’'] },
  ])
  const [livePlaying, setLivePlaying] = useState(true)
  const [scoutQ, setScoutQ] = useState('')
  const [scoutPos, setScoutPos] = useState('Tous')
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [notifications, setNotifications] = useState(true)
  const chatEndRef = useRef(null)

  // VIDEO IA STATE
  const [videoFile, setVideoFile] = useState(null)
  const [videoUrl, setVideoUrl] = useState(null)
  const [videoAnalyzing, setVideoAnalyzing] = useState(false)
  const [videoProgress, setVideoProgress] = useState(0)
  const [videoStep, setVideoStep] = useState('')
  const [videoResult, setVideoResult] = useState(null)
  const fileInputRef = useRef(null)

  // API STATE
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('footballai_api_key') || '')
  const [apiProvider, setApiProvider] = useState(() => localStorage.getItem('footballai_provider') || 'demo')
  const [apiStatus, setApiStatus] = useState('idle') // idle, loading, success, error
  const [apiFixtures, setApiFixtures] = useState([])
  const [apiError, setApiError] = useState('')

  // FANTASY STATE
  const [fantasySquad, setFantasySquad] = useState([])
  const [fantasyCaptain, setFantasyCaptain] = useState(null)
  const [fantasyFilter, setFantasyFilter] = useState('Tous')
  const [fantasySearch, setFantasySearch] = useState('')
  const FANTASY_BUDGET = 500

  // VERSUS STATE
  const [versusA, setVersusA] = useState(PLAYERS[0])
  const [versusB, setVersusB] = useState(PLAYERS[1])

  // live ticker simulation
  useEffect(() => {
    if (!livePlaying) return
    const id = setInterval(() => {
      setLiveMatches(prev => prev.map(m => {
        if (Math.random() > 0.92) {
          const isHome = Math.random() > 0.5
          return { ...m, minute: Math.min(90, m.minute + 1), hScore: isHome ? m.hScore + 1 : m.hScore, aScore: !isHome ? m.aScore + 1 : m.aScore }
        }
        if (Math.random() > 0.85) return { ...m, minute: Math.min(90, m.minute + 1) }
        return m
      }))
    }, 3000)
    return () => clearInterval(id)
  }, [livePlaying])

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [chatMsgs, chatTyping])

  // video analysis simulation
  const startVideoAnalysis = () => {
    if (!videoFile) return
    setVideoAnalyzing(true)
    setVideoProgress(0)
    setVideoStep('Initialisation...')
    setVideoResult(null)
    const steps = [
      { p: 15, t: 'Détection des joueurs (YOLOv8) ...' },
      { p: 35, t: 'Tracking multi-objets & identification...' },
      { p: 55, t: 'Analyse du pressing & PPDA...' },
      { p: 75, t: 'Calcul xG & zones de danger...' },
      { p: 90, t: 'Génération du rapport tactique...' },
      { p: 100, t: 'Terminé !' },
    ]
    let idx = 0
    const interval = setInterval(() => {
      if (idx < steps.length) {
        setVideoProgress(steps[idx].p)
        setVideoStep(steps[idx].t)
        idx++
      } else {
        clearInterval(interval)
        setVideoAnalyzing(false)
        setVideoResult({
          duration: '00:03:42',
          possession: { a: 58, b: 42 },
          pressing: 7.8,
          xg: { a: 1.9, b: 0.7 },
          events: [
            { time: '00:12', type: 'Pressing haut récupéré', team: 'Domicile', score: '+0.12 xG' },
            { time: '00:47', type: 'Transition rapide - occasion manquée', team: 'Extérieur', score: '0.45 xG' },
            { time: '01:22', type: 'But - finition pied gauche', team: 'Domicile', score: '1-0' },
            { time: '02:15', type: 'Perte balle dangereuse', team: 'Domicile', score: 'Risque élevé' },
            { time: '03:10', type: 'Coup franc - xG 0.08', team: 'Extérieur', score: 'Arrêt gardien' },
          ],
          recommendations: [
            'Renforcer la couverture du latéral droit (3 pertes sur son côté)',
            'Exploiter l’intervalle entre DC gauche et latéral adverse (78% de succès)',
            'Pressing à 3 déclenché trop tard à 02:15 - avancer le déclencheur de 1.5s'
          ]
        })
      }
    }, 700)
  }

  const handleVideoUpload = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setVideoFile(f)
    setVideoUrl(URL.createObjectURL(f))
    setVideoResult(null)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    setVideoFile(f)
    setVideoUrl(URL.createObjectURL(f))
    setVideoResult(null)
  }

  // API fetching
  const fetchApiFixtures = async () => {
    setApiStatus('loading')
    setApiError('')
    // Save to localStorage
    localStorage.setItem('footballai_api_key', apiKey)
    localStorage.setItem('footballai_provider', apiProvider)

    try {
      if (apiProvider === 'demo') {
        // demo mode - simulate but also try TheSportsDB free API as real demo
        try {
          const res = await fetch('https://www.thesportsdb.com/api/v1/json/3/eventsnextleague.php?id=4328')
          const data = await res.json()
          if (data.events) {
            setApiFixtures(data.events.slice(0, 6).map(ev => ({
              id: ev.idEvent,
              home: ev.strHomeTeam,
              away: ev.strAwayTeam,
              date: ev.dateEvent + ' ' + (ev.strTime || ''),
              league: ev.strLeague,
              status: ev.strStatus || 'À venir'
            })))
            setApiStatus('success')
            return
          }
        } catch { }
        // fallback mock
        setApiFixtures([
          { id: '1', home: 'Arsenal', away: 'Man Utd', date: '2025-10-21 20:00', league: 'Premier League', status: 'À venir' },
          { id: '2', home: 'Real Madrid', away: 'Barcelona', date: '2025-10-26 18:30', league: 'LaLiga', status: 'À venir' },
          { id: '3', home: 'PSG', away: 'Lyon', date: '2025-10-22 21:00', league: 'Ligue 1', status: 'À venir' },
          { id: '4', home: 'Bayern', away: 'Leverkusen', date: '2025-10-23 19:30', league: 'Bundesliga', status: 'À venir' },
        ])
        setApiStatus('success')
        return
      }

      if (apiProvider === 'api-football') {
        if (!apiKey) throw new Error('Clé API manquante')
        const res = await fetch('https://v3.football.api-sports.io/fixtures?next=5', {
          headers: { 'x-apisports-key': apiKey }
        })
        const data = await res.json()
        if (data.errors && Object.keys(data.errors).length) throw new Error(JSON.stringify(data.errors))
        if (data.response) {
          setApiFixtures(data.response.map(r => ({
            id: r.fixture.id,
            home: r.teams.home.name,
            away: r.teams.away.name,
            date: r.fixture.date,
            league: r.league.name,
            status: r.fixture.status.long
          })))
          setApiStatus('success')
        } else throw new Error('Réponse vide')
        return
      }

      if (apiProvider === 'football-data') {
        if (!apiKey) throw new Error('Clé API manquante')
        const res = await fetch('https://api.football-data.org/v4/matches?limit=5', {
          headers: { 'X-Auth-Token': apiKey }
        })
        const data = await res.json()
        if (data.matches) {
          setApiFixtures(data.matches.map(m => ({
            id: m.id,
            home: m.homeTeam.name,
            away: m.awayTeam.name,
            date: m.utcDate,
            league: m.competition.name,
            status: m.status
          })))
          setApiStatus('success')
        } else throw new Error(data.message || 'Erreur API')
      }
    } catch (err) {
      setApiStatus('error')
      setApiError(err.message)
    }
  }

  const generatePrediction = () => {
    setPredLoading(true)
    setTimeout(() => {
      const diff = homeTeam.rating - awayTeam.rating + (Math.random() * 6 - 3)
      const homeProb = Math.max(15, Math.min(75, 45 + diff * 1.8))
      const awayProb = Math.max(10, Math.min(60, 38 - diff * 1.2))
      const drawProb = 100 - homeProb - awayProb
      setPrediction({
        homeProb: homeProb.toFixed(1), drawProb: drawProb.toFixed(1), awayProb: awayProb.toFixed(1),
        xgHome: (1.2 + diff * 0.04 + Math.random() * 0.4).toFixed(2),
        xgAway: (1.1 - diff * 0.03 + Math.random() * 0.4).toFixed(2),
        score: `${Math.round(0.8 + homeProb / 30)} - ${Math.round(0.7 + awayProb / 35)}`,
        confidence: Math.round(72 + Math.random() * 15),
        factors: [
          { label: 'Forme récente', home: 68 + diff, away: 60 - diff, icon: TrendingUp },
          { label: 'Avantage domicile', home: 72, away: 28, icon: Shield },
          { label: 'xG créés (5 matchs)', home: 9.2, away: 7.8, icon: Target },
          { label: 'Blessures / suspensions', home: 85, away: 62, icon: Activity },
        ]
      })
      setPredLoading(false)
    }, 1200)
  }

  const sendChat = () => {
    if (!chatInput.trim()) return
    const q = chatInput
    setChatMsgs(m => [...m, { role: 'user', text: q }])
    setChatInput('')
    setChatTyping(true)
    setTimeout(() => {
      let reply = ''
      const low = q.toLowerCase()
      if (low.includes('mbappé') || low.includes('mbappe')) reply = "Kylian Mbappé est en feu cette saison 🔥\n\n📊 Stats 24/25 : 31 matchs, 28 buts, 7 passes décisives\n⚡️ Vitesse max : 38.2 km/h\n🎯 xG : 0.78 par 90min\n\nIl excelle dans les appels en profondeur et le 1v1. Tu veux une analyse tactique de son placement ?"
      else if (low.includes('prédiction') || low.includes('pronostic') || low.includes('predi')) reply = "Pour te donner une prédiction ultra précise, va dans l'onglet **Prédicteur IA** 🎯\n\nJe prends en compte :\n• Forme des 5 derniers matchs\n• xG et xGA\n• Blessures & suspensions\n• Avantage domicile\n• Confrontations directes\n\nTu peux aussi me donner 2 équipes ici, je te fais le prono direct !"
      else if (low.includes('tactique') || low.includes('4-3-3') || low.includes('formation')) reply = "Bonne question tactique ! 🧠\n\nLe **4-3-3** est idéal pour :\n• Pressing haut + largeur\n• Triangulation au milieu\n• Ailiers qui rentrent intérieur\n\nFaiblesse : vulnérable dans le dos des latéraux.\n\nAlternative : le **4-2-3-1** offre plus d'équilibre défensif avec double pivot. Tu veux que je te montre sur le tableau tactique ?"
      else if (low.includes('haaland')) reply = "Erling Haaland = machine à buts 🤖\n\n📈 0.92 but / 90min\n💪 92 de physique - impossible à bouger\n🎯 Finition pied gauche : 94%\n\nSon secret : timing des appels et placement entre les défenseurs. Il touche peu de ballons mais les bons."
      else if (low.includes('psg') || low.includes('paris')) reply = "Le PSG cette saison c'est du sérieux ✨\n\n• 1er de Ligue 1 avec 68 pts\n• 2.3 buts marqués / match\n• Possession moyenne 62%\n\nPoint fort : transitions rapides avec Dembélé-Barcola.\nÀ améliorer : efficacité sur coups de pied arrêtés (seulement 7%)."
      else reply = "Excellente question ! ⚽️\n\nEn tant qu'IA football, je peux t'aider sur :\n• **Prédictions** de matchs avec probas & score exact\n• **Analyse tactique** (formations, pressing, phases)\n• **Stats joueurs** détaillées et comparaisons\n• **Mercato** & valeurs marchandes\n• **Live** avec xG et momentum\n• **Nouveau** : Analyse vidéo + Fantasy + Versus !\n\nDis-m'en plus, ou teste le Prédicteur IA pour voir la magie opérer ! ✨"
      setChatMsgs(m => [...m, { role: 'bot', text: reply }])
      setChatTyping(false)
    }, 1100)
  }

  const filteredPlayers = PLAYERS.filter(p =>
    (scoutPos === 'Tous' || p.pos === scoutPos) &&
    (p.name.toLowerCase().includes(scoutQ.toLowerCase()) || p.team.toLowerCase().includes(scoutQ.toLowerCase()))
  )

  // Fantasy helpers
  const fantasyBudgetUsed = fantasySquad.reduce((s, p) => s + p.value, 0)
  const fantasyBudgetLeft = FANTASY_BUDGET - fantasyBudgetUsed
  const fantasyFiltered = FANTASY_POOL.filter(p =>
    (fantasyFilter === 'Tous' || p.pos === fantasyFilter) &&
    (p.name.toLowerCase().includes(fantasySearch.toLowerCase()) || p.team.toLowerCase().includes(fantasySearch.toLowerCase())) &&
    !fantasySquad.find(s => s.id === p.id)
  )
  const addFantasy = (p) => {
    if (fantasySquad.length >= 11) return
    if (fantasyBudgetLeft < p.value) return
    setFantasySquad(s => [...s, p])
    if (!fantasyCaptain) setFantasyCaptain(p.id)
  }
  const removeFantasy = (id) => setFantasySquad(s => s.filter(p => p.id !== id))
  const autoFantasy = () => {
    const sorted = [...FANTASY_POOL].sort((a, b) => (b.rating / b.value) - (a.rating / a.value))
    let squad = [], budget = 0
    for (let p of sorted) {
      if (squad.length >= 11) break
      if (budget + p.value <= FANTASY_BUDGET) { squad.push(p); budget += p.value }
    }
    setFantasySquad(squad)
    if (squad[0]) setFantasyCaptain(squad[0].id)
  }

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, enabled: enabled.dashboard },
    { id: 'predictor', label: 'Prédicteur IA', icon: Zap, badge: 'IA', enabled: enabled.predictor },
    { id: 'video', label: 'Vidéo IA', icon: Video, badge: 'NEW', enabled: enabled.video },
    { id: 'live', label: 'Live Center', icon: Radio, dot: true, enabled: enabled.live },
    { id: 'fantasy', label: 'Fantasy Lab', icon: Crown, badge: 'NEW', enabled: enabled.fantasy },
    { id: 'versus', label: 'Versus', icon: Swords, enabled: enabled.versus },
    { id: 'chat', label: 'Assistant IA', icon: MessageCircle, enabled: enabled.chat },
    { id: 'tactics', label: 'Tactique', icon: MapPinned, enabled: enabled.tactics },
    { id: 'scout', label: 'Scout Lab', icon: Search, enabled: enabled.scout },
    { id: 'api', label: 'API Connect', icon: Database, enabled: enabled.api },
  ].filter(n => n.enabled)

  return (
    <div className="min-h-screen bg-[#050805] text-white selection:bg-[#22c55e]/30 flex">
      {/* SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-[280px] bg-[#0a120a] border-r border-white/[0.06] flex flex-col transition-transform lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:sticky lg:top-0 lg:h-screen`}>
        <div className="h-[72px] px-6 flex items-center gap-3 border-b border-white/[0.06] shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#22c55e] to-[#15803d] flex items-center justify-center font-black text-[16px]">◈</div>
          <div>
            <div className="font-black tracking-tight leading-none text-[16px]">FOOTBALL<span className="text-[#22c55e]">AI</span></div>
            <div className="text-[10px] tracking-[0.18em] text-white/40 font-semibold">INTELLIGENCE TACTIQUE</div>
          </div>
          <div className="ml-auto lg:hidden">
            <button onClick={() => setMobileOpen(false)} className="p-2 rounded-lg bg-white/5"><X size={18} /></button>
          </div>
        </div>

        <div className="p-3 flex-1 overflow-y-auto">
          <div className="text-[10px] tracking-[0.16em] text-white/30 font-bold px-3 py-2">NAVIGATION</div>
          <nav className="space-y-1">
            {navItems.map(it => (
              <button key={it.id} onClick={() => { setActive(it.id); setMobileOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-[11px] rounded-xl text-[13.5px] font-medium transition ${active === it.id ? 'bg-[#22c55e] text-[#052e15] shadow-[0_8px_24px_rgba(34,197,94,0.25)]' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'}`}>
                <it.icon size={18} className={active === it.id ? 'opacity-100' : 'opacity-70'} />
                <span className="flex-1 text-left">{it.label}</span>
                {it.badge && <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${active === it.id ? 'bg-black/15 text-black' : it.badge === 'NEW' ? 'bg-violet-600 text-white' : 'bg-[#22c55e] text-black'}`}>{it.badge}</span>}
                {it.dot && <span className="w-2 h-2 rounded-full bg-red-500 pulse-dot shadow-[0_0_8px_rgba(239,68,68,0.8)]" />}
                {active === it.id && <ChevronRight size={16} />}
              </button>
            ))}
          </nav>

          <div className="mt-4 rounded-2xl p-4 bg-gradient-to-br from-[#1a3a1a] to-[#0f2410] border border-[#22c55e]/20 relative overflow-hidden">
            <div className="absolute -right-6 -top-6 w-24 h-24 bg-[#22c55e]/15 blur-2xl rounded-full" />
            <div className="flex items-center gap-2 text-[#22c55e] text-xs font-extrabold tracking-wide"><Sparkles size={14} /> PRO PLAN</div>
            <div className="mt-2 text-[13px] font-semibold leading-snug">API + Vidéo IA<br />débloqués</div>
            <div className="mt-2 flex gap-2 text-[11px]">
              <span className="bg-[#22c55e] text-black font-bold px-2 py-1 rounded-full flex items-center gap-1"><CheckCircle2 size={12} /> Actif</span>
              <span className="bg-white/10 px-2 py-1 rounded-full">500 crédits</span>
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-white/[0.06]">
          <button onClick={() => setActive('settings')} className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm ${active === 'settings' ? 'bg-white/[0.07] text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.05]'}`}>
            <Settings size={18} /> Gérer les options <span className="ml-auto text-xs bg-white/10 px-2 py-0.5 rounded-full">{Object.values(enabled).filter(Boolean).length}/10</span>
          </button>
          <div className="mt-3 flex items-center gap-3 px-2">
            <img src="https://i.pravatar.cc/100?img=8" className="w-9 h-9 rounded-full border border-white/10" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold leading-none">Alex Martin</div>
              <div className="text-xs text-white/40">Coach • Pro</div>
            </div>
            <div className="w-2 h-2 bg-[#22c55e] rounded-full shadow-[0_0_8px_rgba(34,197,94,0.8)]" />
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex-1 min-w-0">
        {/* TOPBAR */}
        <header className="sticky top-0 z-30 bg-[#050805]/80 backdrop-blur-xl border-b border-white/[0.06]">
          <div className="h-[72px] px-4 lg:px-8 flex items-center gap-4">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2.5 rounded-xl bg-white/[0.06] border border-white/10"><Layers size={18} /></button>

            <div className="hidden md:flex items-center gap-2 text-sm">
              <span className="text-white/40">FootballAI</span><ChevronRight size={14} className="text-white/20" />
              <span className="font-semibold capitalize">{active === 'dashboard' ? 'Dashboard' : active === 'predictor' ? 'Prédicteur IA' : active === 'video' ? 'Vidéo IA' : active === 'chat' ? 'Assistant IA' : active === 'tactics' ? 'Tableau Tactique' : active === 'live' ? 'Live Center' : active === 'scout' ? 'Scout Lab' : active === 'fantasy' ? 'Fantasy Lab' : active === 'versus' ? 'Versus' : active === 'api' ? 'API Connect' : 'Options'}</span>
              {active === 'live' && <span className="ml-2 inline-flex items-center gap-1.5 bg-red-500 text-white text-[11px] font-extrabold px-2.5 py-1 rounded-full"><span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" /> LIVE</span>}
              {(active === 'video' || active === 'fantasy' || active === 'versus') && <span className="ml-2 bg-violet-600 text-white text-[11px] font-black px-2 py-1 rounded-full">NOUVEAU</span>}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 bg-white/[0.06] border border-white/10 rounded-full px-3 py-1.5">
                <div className="w-2 h-2 bg-[#22c55e] rounded-full animate-pulse" />
                <span className="text-xs font-medium text-white/80">IA en ligne</span>
                <span className="text-[11px] bg-[#22c55e] text-black font-extrabold px-2 py-0.5 rounded-full">98.4%</span>
              </div>
              <div className="flex items-center gap-1 bg-[#111b11] border border-white/10 rounded-full p-1">
                <button className="px-3 py-1.5 rounded-full bg-white text-black text-xs font-bold">Saison 24/25</button>
                <button className="px-3 py-1.5 rounded-full text-white/60 text-xs">UCL</button>
              </div>
              <button onClick={() => setNotifications(!notifications)} className="w-10 h-10 rounded-full bg-white/[0.06] border border-white/10 grid place-items-center relative">
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-[#050805]" />
                <Flag size={16} />
              </button>
            </div>
          </div>
        </header>

        <main className="px-4 lg:px-8 py-6 lg:py-8">
          {/* DASHBOARD */}
          {active === 'dashboard' && (
            <div className="space-y-6">
              <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#0f2a12] via-[#0c1f0d] to-[#091009] border border-white/[0.07] p-6 lg:p-8">
                <div className="absolute inset-0">
                  <div className="absolute -right-20 -top-20 w-[420px] h-[420px] bg-[#22c55e]/20 blur-[80px] rounded-full" />
                  <div className="absolute -left-10 bottom-0 w-[360px] h-[360px] bg-[#16a34a]/10 blur-[70px] rounded-full" />
                  <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '18px 18px' }} />
                </div>
                <div className="relative flex flex-col lg:flex-row gap-6 lg:items-center justify-between">
                  <div className="max-w-[640px]">
                    <div className="inline-flex items-center gap-2 bg-[#22c55e]/15 border border-[#22c55e]/20 text-[#86efac] text-xs font-bold px-3 py-1.5 rounded-full">
                      <Gauge size={14} /> NOUVEAU • Vidéo IA + Fantasy + API Connect • v5.0
                    </div>
                    <h1 className="mt-4 text-[28px] lg:text-[40px] font-black leading-[0.95] tracking-tight">
                      L'intelligence qui<br />
                      <span className="bg-gradient-to-r from-[#22c55e] to-[#86efac] bg-clip-text text-transparent">prédit le football.</span>
                    </h1>
                    <p className="mt-3 text-white/60 text-[14px] lg:text-[15px] leading-relaxed">Analyse 1.2M+ datapoints par match • xG, pressing, transitions • Vidéo IA + Fantasy + API temps réel.</p>
                    <div className="mt-6 flex flex-wrap gap-3">
                      <button onClick={() => setActive('predictor')} className="inline-flex items-center gap-2 bg-[#22c55e] text-black font-extrabold px-5 py-3 rounded-full hover:bg-[#16a34a] transition">Lancer une prédiction <ArrowUpRight size={16} /></button>
                      <button onClick={() => setActive('video')} className="inline-flex items-center gap-2 bg-violet-600 text-white font-bold px-5 py-3 rounded-full">Analyser une vidéo <Video size={16} /></button>
                    </div>
                  </div>
                  <div className="lg:w-[360px] shrink-0 grid grid-cols-2 gap-3">
                    <div className="glass rounded-2xl p-4">
                      <div className="text-white/50 text-xs font-semibold tracking-wide">MATCHS ANALYSÉS</div>
                      <div className="text-2xl font-black mt-1">12,847</div>
                      <div className="text-[#22c55e] text-xs font-bold flex items-center gap-1"><TrendingUp size={12} />+14% cette semaine</div>
                    </div>
                    <div className="glass rounded-2xl p-4">
                      <div className="text-white/50 text-xs font-semibold tracking-wide">PRÉCISION IA</div>
                      <div className="text-2xl font-black mt-1">89.3%</div>
                      <div className="text-white/50 text-xs">sur 1X2</div>
                    </div>
                    <div className="col-span-2 glass rounded-2xl p-4 flex items-center gap-4">
                      <div className="w-10 h-10 rounded-full bg-[#22c55e] grid place-items-center text-black"><Brain size={18} /></div>
                      <div>
                        <div className="text-sm font-bold">3 nouveautés majeures</div>
                        <div className="text-xs text-white/50">Vidéo IA • Fantasy Lab • API Connect</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {[
                  { k: 'xG moyen créé', v: '1.84', sub: 'par match', icon: Crosshair, color: 'from-[#22c55e] to-[#16a34a]' },
                  { k: 'Pressing intensity', v: '7.2', sub: 'PPDA • Top 10%', icon: Flame, color: 'from-orange-500 to-red-500' },
                  { k: 'Possession', v: '58.4%', sub: 'moyenne équipe', icon: Hexagon, color: 'from-sky-500 to-blue-600' },
                  { k: 'Clean sheets', v: '42%', sub: 'sur 10 matchs', icon: Shield, color: 'from-violet-500 to-purple-600' },
                ].map(c => (
                  <div key={c.k} className="glass rounded-2xl p-5 relative overflow-hidden">
                    <div className={`absolute -right-8 -top-8 w-24 h-24 bg-gradient-to-br ${c.color} opacity-20 blur-2xl rounded-full`} />
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${c.color} grid place-items-center`}><c.icon size={16} /></div>
                    <div className="mt-4 text-white/50 text-xs font-bold tracking-wide">{c.k}</div>
                    <div className="text-[26px] font-black leading-none mt-1">{c.v}</div>
                    <div className="text-xs text-white/40">{c.sub}</div>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
                <div className="glass-strong rounded-2xl p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold flex items-center gap-2"><BarChart3 size={16} className="text-[#22c55e]" /> Momentum & xG — 5 derniers matchs</h3>
                    <span className="text-xs bg-white/10 px-2.5 py-1 rounded-full">PSG • forme</span>
                  </div>
                  <div className="h-[220px] mt-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={[{ n: 'J1', xg: 1.2, xa: 0.8 }, { n: 'J2', xg: 2.1, xa: 0.6 }, { n: 'J3', xg: 1.8, xa: 1.1 }, { n: 'J4', xg: 2.4, xa: 0.9 }, { n: 'J5', xg: 1.9, xa: 0.7 }]}>
                        <XAxis dataKey="n" stroke="#ffffff30" fontSize={11} />
                        <YAxis stroke="#ffffff30" fontSize={11} />
                        <Tooltip contentStyle={{ background: '#0a120a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12 }} />
                        <Area type="monotone" dataKey="xg" stroke="#22c55e" fill="#22c55e33" strokeWidth={2.5} />
                        <Area type="monotone" dataKey="xa" stroke="#ef4444" fill="#ef444433" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#22c55e]" /> xG créés</span>
                    <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#ef4444]" /> xG concédés</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="glass-strong rounded-2xl p-5">
                    <h3 className="font-bold flex items-center gap-2"><Trophy size={16} className="text-yellow-400" /> Top prédictions du jour</h3>
                    <div className="mt-4 space-y-3">
                      {[
                        { m: 'PSG vs Marseille', p: 'PSG 62%', c: 'Confiance élevée' },
                        { m: 'Real vs Barça', p: 'Nul 31%', c: 'Match serré' },
                        { m: 'City vs Arsenal', p: 'City 48%', c: 'Avantage domicile' },
                      ].map(r => (
                        <div key={r.m} className="flex items-center justify-between bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-3">
                          <div><div className="text-sm font-semibold">{r.m}</div><div className="text-xs text-white/50">{r.c}</div></div>
                          <div className="text-sm font-black text-[#22c55e]">{r.p}</div>
                        </div>
                      ))}
                    </div>
                    <button onClick={() => setActive('predictor')} className="mt-4 w-full bg-white text-black font-bold py-2.5 rounded-xl text-sm">Voir toutes les prédictions</button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => setActive('video')} className="glass rounded-2xl p-4 flex flex-col gap-2 text-left hover:bg-white/[0.08]">
                      <div className="w-10 h-10 rounded-xl bg-violet-600 grid place-items-center"><Video size={16} /></div>
                      <div className="font-bold text-sm">Vidéo IA</div>
                      <div className="text-xs text-white/50">Analyse un clip</div>
                    </button>
                    <button onClick={() => setActive('fantasy')} className="glass rounded-2xl p-4 flex flex-col gap-2 text-left hover:bg-white/[0.08]">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500 grid place-items-center"><Crown size={16} /></div>
                      <div className="font-bold text-sm">Fantasy</div>
                      <div className="text-xs text-white/50">Compose ton équipe</div>
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { t: 'Prédicteur IA', d: 'Score exact + probas', icon: Zap, id: 'predictor', grad: 'from-[#22c55e] to-[#15803d]' },
                  { t: 'Vidéo IA', d: 'Upload & analyse auto', icon: Video, id: 'video', grad: 'from-violet-600 to-indigo-600' },
                  { t: 'Fantasy Lab', d: 'Draft + capitaine IA', icon: Crown, id: 'fantasy', grad: 'from-yellow-500 to-orange-600' },
                  { t: 'Versus', d: 'Compare 2 joueurs', icon: Swords, id: 'versus', grad: 'from-sky-500 to-blue-600' },
                ].map(q => (
                  <button key={q.t} onClick={() => setActive(q.id)} className="text-left glass rounded-2xl p-4 hover:bg-white/[0.08] transition group">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${q.grad} grid place-items-center`}><q.icon size={18} /></div>
                    <div className="mt-3 font-bold">{q.t}</div>
                    <div className="text-xs text-white/50">{q.d}</div>
                    <div className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-white/70 group-hover:text-white">Ouvrir <ChevronRight size={14} /></div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PREDICTOR */}
          {active === 'predictor' && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <h1 className="text-[24px] font-black tracking-tight flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-[#22c55e] text-black grid place-items-center"><Zap size={18} /></span> Prédicteur IA <span className="text-xs bg-[#22c55e] text-black font-black px-2.5 py-1 rounded-full">v4.2</span></h1>
                <div className="text-xs text-white/50 flex items-center gap-2"><Clock size={14} /> Dernière MAJ il y a 12 min • données Opta</div>
              </div>

              <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="glass-strong rounded-[24px] p-6">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <TeamPicker team={homeTeam} onSelect={setHomeTeam} label="Domicile" />
                    <div className="text-center">
                      <div className="w-10 h-10 rounded-full bg-white text-black grid place-items-center font-black text-sm mx-auto">VS</div>
                      <div className="text-[11px] text-white/40 mt-1 font-bold tracking-wide">LIGUE 1 • J28</div>
                    </div>
                    <TeamPicker team={awayTeam} onSelect={setAwayTeam} label="Extérieur" />
                  </div>

                  <div className="mt-6 grid grid-cols-3 gap-3">
                    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 text-center">
                      <div className="text-[11px] tracking-wide font-bold text-white/40">FORME</div>
                      <div className="mt-2 flex justify-center gap-1">
                        {homeTeam.form.split('').map((c, i) => (
                          <span key={i} className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-black ${c === 'W' ? 'bg-[#22c55e] text-black' : c === 'D' ? 'bg-white/20 text-white' : 'bg-red-500 text-white'}`}>{c}</span>
                        ))}
                      </div>
                      <div className="text-xs text-white/50 mt-1">{homeTeam.short} • 4V 1N</div>
                    </div>
                    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 text-center">
                      <div className="text-[11px] tracking-wide font-bold text-white/40">RATING IA</div>
                      <div className="text-xl font-black">{homeTeam.rating} — {awayTeam.rating}</div>
                      <div className="text-xs text-white/50">sur 100</div>
                    </div>
                    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4 text-center">
                      <div className="text-[11px] tracking-wide font-bold text-white/40">FORME</div>
                      <div className="mt-2 flex justify-center gap-1">
                        {awayTeam.form.split('').map((c, i) => (
                          <span key={i} className={`w-6 h-6 rounded-full grid place-items-center text-[11px] font-black ${c === 'W' ? 'bg-[#22c55e] text-black' : c === 'D' ? 'bg-white/20 text-white' : 'bg-red-500 text-white'}`}>{c}</span>
                        ))}
                      </div>
                      <div className="text-xs text-white/50 mt-1">{awayTeam.short} • 3V 1N 1D</div>
                    </div>
                  </div>

                  <button onClick={generatePrediction} disabled={predLoading} className="mt-6 w-full bg-[#22c55e] hover:bg-[#16a34a] disabled:opacity-60 text-black font-black py-4 rounded-full flex items-center justify-center gap-2 text-[15px]">
                    {predLoading ? <><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> Analyse en cours...</> : <><Brain size={18} /> Générer la prédiction IA</>}
                  </button>
                  <div className="text-center text-xs text-white/30 mt-2">Modèle entraîné sur 47 000 matchs • inférence &lt; 800ms</div>
                </div>

                <div className="glass-strong rounded-[24px] p-6 min-h-[420px] flex flex-col">
                  {!prediction ? (
                    <div className="flex-1 grid place-items-center text-center p-8">
                      <div>
                        <div className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/10 grid place-items-center mx-auto"><Target size={22} className="text-white/60" /></div>
                        <div className="mt-4 font-bold">Aucune prédiction pour l'instant</div>
                        <div className="text-sm text-white/50 mt-1 max-w-[280px] mx-auto">Choisis deux équipes et lance l'IA pour obtenir probas, score exact, xG et facteurs clés.</div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="flex items-center justify-between">
                        <h3 className="font-black">Résultat IA</h3>
                        <span className="text-xs bg-[#22c55e] text-black font-extrabold px-3 py-1 rounded-full">Confiance {prediction.confidence}%</span>
                      </div>
                      <div className="bg-[#0a1a0a] border border-[#22c55e]/20 rounded-2xl p-4">
                        <div className="text-xs font-bold tracking-wide text-white/50">SCORE PRÉDIT</div>
                        <div className="text-[36px] font-black leading-none mt-1">{prediction.score}</div>
                        <div className="text-xs text-white/50">Le plus probable (30% de proba)</div>
                      </div>
                      <div className="space-y-3">
                        {[
                          { label: `${homeTeam.short} gagne`, value: prediction.homeProb, color: 'bg-[#22c55e]' },
                          { label: 'Match nul', value: prediction.drawProb, color: 'bg-white/60' },
                          { label: `${awayTeam.short} gagne`, value: prediction.awayProb, color: 'bg-[#60a5fa]' },
                        ].map(r => (
                          <div key={r.label}>
                            <div className="flex justify-between text-sm"><span className="font-medium">{r.label}</span><span className="font-black">{r.value}%</span></div>
                            <div className="mt-1 h-2 bg-white/10 rounded-full overflow-hidden">
                              <div className={`h-full ${r.color} rounded-full transition-all`} style={{ width: `${r.value}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3">
                          <div className="text-xs text-white/50 font-bold">xG {homeTeam.short}</div>
                          <div className="text-xl font-black text-[#22c55e]">{prediction.xgHome}</div>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3">
                          <div className="text-xs text-white/50 font-bold">xG {awayTeam.short}</div>
                          <div className="text-xl font-black text-[#60a5fa]">{prediction.xgAway}</div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-bold tracking-wide text-white/50 mb-2">FACTEURS CLÉS</div>
                        <div className="space-y-2">
                          {prediction.factors.map(f => (
                            <div key={f.label} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-xl px-3 py-2.5">
                              <div className="w-8 h-8 rounded-lg bg-white/10 grid place-items-center"><f.icon size={14} /></div>
                              <div className="flex-1 text-sm font-medium">{f.label}</div>
                              <div className="text-xs font-bold text-[#22c55e]">{f.home > f.away ? 'Avantage domicile' : 'Équilibré'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* VIDEO IA */}
          {active === 'video' && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <h1 className="text-[24px] font-black flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-violet-600 grid place-items-center"><Video size={18} /></span> Vidéo IA <span className="text-xs bg-violet-600 px-2.5 py-1 rounded-full">BETA</span></h1>
                <div className="text-xs text-white/50 flex items-center gap-2"><Cpu size={14} /> YOLOv8 + Tracking • &lt; 45s d'analyse</div>
              </div>

              <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="space-y-4">
                  <div
                    onDragOver={e => e.preventDefault()}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`glass-strong rounded-[24px] p-6 border-2 border-dashed cursor-pointer transition ${videoFile ? 'border-[#22c55e]/50 bg-[#22c55e]/5' : 'border-white/15 hover:border-violet-500/50 hover:bg-white/[0.02]'}`}>
                    <input ref={fileInputRef} type="file" accept="video/*" onChange={handleVideoUpload} className="hidden" />
                    {!videoFile ? (
                      <div className="text-center py-8">
                        <div className="w-16 h-16 rounded-2xl bg-violet-600 grid place-items-center mx-auto"><Upload size={24} /></div>
                        <div className="mt-4 font-black text-lg">Glisse ta vidéo ici</div>
                        <div className="text-sm text-white/50 mt-1">ou clique pour parcourir • MP4, MOV, AVI • max 200MB</div>
                        <div className="mt-4 inline-flex gap-2">
                          <span className="text-xs bg-white text-black font-bold px-3 py-1.5 rounded-full">Choisir un fichier</span>
                          <span className="text-xs bg-white/10 px-3 py-1.5 rounded-full">Essayer avec un exemple</span>
                        </div>
                        <div className="mt-6 grid grid-cols-3 gap-3 text-left">
                          {[
                            { t: 'Détection auto', d: '22 joueurs + ballon' },
                            { t: 'Pressing & xG', d: 'Calcul en temps réel' },
                            { t: 'Rapport PDF', d: 'Export tactique' },
                          ].map(f => (
                            <div key={f.t} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                              <div className="text-xs font-bold">{f.t}</div>
                              <div className="text-[11px] text-white/40">{f.d}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-[#22c55e] text-black grid place-items-center"><FileVideo size={18} /></div>
                          <div className="flex-1 min-w-0">
                            <div className="font-bold truncate">{videoFile.name}</div>
                            <div className="text-xs text-white/50">{(videoFile.size / 1024 / 1024).toFixed(1)} MB • {videoResult ? videoResult.duration : '00:03:42'} • 1080p</div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setVideoFile(null); setVideoUrl(null); setVideoResult(null) }} className="w-8 h-8 rounded-full bg-white/10 grid place-items-center"><X size={14} /></button>
                        </div>
                        {videoUrl && (
                          <video src={videoUrl} controls className="mt-4 w-full rounded-xl bg-black max-h-[260px]" />
                        )}
                        <div className="mt-4 flex gap-2">
                          <button onClick={(e) => { e.stopPropagation(); startVideoAnalysis() }} disabled={videoAnalyzing} className="flex-1 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-black py-3 rounded-full flex items-center justify-center gap-2">
                            {videoAnalyzing ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Analyse...</> : <><Wand2 size={16} /> Lancer l'analyse IA</>}
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); setVideoFile(null); setVideoUrl(null) }} className="px-4 py-3 rounded-full bg-white/10 font-bold text-sm">Changer</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {videoAnalyzing && (
                    <div className="glass-strong rounded-2xl p-5">
                      <div className="flex justify-between text-sm font-bold"><span>Analyse en cours</span><span className="text-violet-400">{videoProgress}%</span></div>
                      <div className="mt-2 h-2 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-violet-600 rounded-full transition-all duration-500" style={{ width: `${videoProgress}%` }} />
                      </div>
                      <div className="text-xs text-white/50 mt-2 flex items-center gap-2"><span className="w-1.5 h-1.5 bg-violet-500 rounded-full animate-ping" /> {videoStep}</div>
                    </div>
                  )}

                  {/* Upload example button outside */}
                  {!videoFile && (
                    <div className="flex gap-2">
                      <button onClick={() => {
                        // create dummy file for demo
                        const blob = new Blob(['demo'], { type: 'video/mp4' })
                        const f = new File([blob], 'PSG_vs_OM_2024.mp4', { type: 'video/mp4' })
                        Object.defineProperty(f, 'size', { value: 42 * 1024 * 1024 })
                        setVideoFile(f)
                        setVideoUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4')
                      }} className="flex-1 bg-white/[0.06] border border-white/10 rounded-xl py-3 text-sm font-bold">🎬 Charger vidéo d'exemple</button>
                    </div>
                  )}
                </div>

                <div className="glass-strong rounded-[24px] p-6 min-h-[420px]">
                  {!videoResult ? (
                    <div className="h-full grid place-items-center text-center p-8">
                      <div>
                        <div className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/10 grid place-items-center mx-auto"><Eye size={22} className="text-white/60" /></div>
                        <div className="mt-4 font-bold">Aucune analyse pour l'instant</div>
                        <div className="text-sm text-white/50 mt-1 max-w-[280px] mx-auto">Upload une vidéo et l'IA détecte automatiquement pressing, transitions, erreurs et xG.</div>
                        <div className="mt-4 text-xs text-white/30">Modèle : YOLOv8 + DeepSORT • Précision 94.1%</div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-5">
                      <div className="flex items-center justify-between">
                        <h3 className="font-black">Rapport IA</h3>
                        <span className="text-xs bg-[#22c55e] text-black font-black px-3 py-1 rounded-full">95% confiance</span>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3 text-center">
                          <div className="text-[11px] font-bold text-white/40">POSSESSION</div>
                          <div className="text-lg font-black">{videoResult.possession.a}% - {videoResult.possession.b}%</div>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3 text-center">
                          <div className="text-[11px] font-bold text-white/40">xG TOTAL</div>
                          <div className="text-lg font-black">{videoResult.xg.a} - {videoResult.xg.b}</div>
                        </div>
                        <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-3 text-center">
                          <div className="text-[11px] font-bold text-white/40">PPDA</div>
                          <div className="text-lg font-black">{videoResult.pressing}</div>
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-bold tracking-wide text-white/50 mb-2">TIMELINE DÉTECTÉE</div>
                        <div className="space-y-2">
                          {videoResult.events.map((ev, i) => (
                            <div key={i} className="flex gap-3 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5">
                              <span className="text-xs font-black bg-violet-600 text-white px-2 py-1 rounded-full h-fit">{ev.time}</span>
                              <div className="flex-1">
                                <div className="text-sm font-medium">{ev.type}</div>
                                <div className="text-xs text-white/50">{ev.team} • {ev.score}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="bg-violet-600/10 border border-violet-600/20 rounded-xl p-3">
                        <div className="font-bold text-violet-300 text-sm">💡 Recommandations coach</div>
                        <ul className="mt-2 space-y-1">
                          {videoResult.recommendations.map((r, i) => (
                            <li key={i} className="text-xs text-white/70 flex gap-2"><span className="text-violet-400">•</span> {r}</li>
                          ))}
                        </ul>
                      </div>

                      <button className="w-full bg-white text-black font-bold py-3 rounded-xl text-sm">Exporter rapport PDF</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* FANTASY */}
          {active === 'fantasy' && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <h1 className="text-[24px] font-black flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-600 grid place-items-center"><Crown size={18} /></span> Fantasy Lab <span className="text-xs bg-yellow-500 text-black font-black px-2.5 py-1 rounded-full">SAISON 24/25</span></h1>
                <div className="flex items-center gap-2">
                  <div className={`px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 ${fantasyBudgetLeft >= 0 ? 'bg-[#22c55e] text-black' : 'bg-red-500 text-white'}`}>
                    <DollarSign size={14} /> Budget: {fantasyBudgetLeft.toFixed(0)}M€ / {FANTASY_BUDGET}M€
                  </div>
                  <button onClick={autoFantasy} className="bg-violet-600 text-white px-4 py-2 rounded-full text-sm font-bold flex items-center gap-1"><Wand2 size={14} /> Auto-compléter (IA)</button>
                </div>
              </div>

              <div className="grid lg:grid-cols-[320px_1fr] gap-6">
                {/* PITCH */}
                <div className="glass-strong rounded-[24px] p-4">
                  <div className="flex justify-between items-center">
                    <h3 className="font-bold">Mon équipe</h3>
                    <span className="text-xs bg-white/10 px-2 py-1 rounded-full">{fantasySquad.length}/11 joueurs</span>
                  </div>

                  {/* Mini pitch */}
                  <div className="mt-4 relative bg-gradient-to-b from-[#1a6b1a] to-[#0f4d0f] rounded-2xl p-3 min-h-[420px] border border-white/10">
                    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-20">
                      <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeWidth="0.6" rx="1" />
                      <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeWidth="0.5" />
                      <circle cx="50" cy="50" r="9" fill="none" stroke="white" strokeWidth="0.5" />
                    </svg>
                    {fantasySquad.length === 0 ? (
                      <div className="relative h-[420px] grid place-items-center text-center">
                        <div className="text-white/60 text-sm">Ajoute des joueurs depuis la liste →</div>
                      </div>
                    ) : (
                      <div className="relative grid grid-cols-3 gap-2 place-items-center py-6">
                        {fantasySquad.map(p => (
                          <div key={p.id} className={`relative bg-white text-black rounded-xl px-2 py-2 w-full text-center border-2 ${fantasyCaptain === p.id ? 'border-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.6)]' : 'border-[#22c55e]'}`}>
                            <div className="text-[11px] font-black">{p.name.split(' ')[1] || p.name}</div>
                            <div className="text-[10px] text-black/60">{p.pos} • {p.rating}</div>
                            <button onClick={() => removeFantasy(p.id)} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full grid place-items-center"><X size={10} /></button>
                            {fantasyCaptain === p.id && <span className="absolute -top-2 -left-2 bg-yellow-400 text-black text-[10px] font-black px-1.5 py-0.5 rounded-full">C</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-2">
                    <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3 text-center">
                      <div className="text-[11px] text-white/40 font-bold">NOTE MOY</div>
                      <div className="font-black">{fantasySquad.length ? (fantasySquad.reduce((s, p) => s + p.rating, 0) / fantasySquad.length).toFixed(1) : '-'}</div>
                    </div>
                    <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3 text-center">
                      <div className="text-[11px] text-white/40 font-bold">PROJECTION</div>
                      <div className="font-black text-[#22c55e]">{fantasySquad.length ? (fantasySquad.reduce((s, p) => s + p.rating, 0) / 10).toFixed(0) : 0} pts</div>
                    </div>
                    <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3 text-center">
                      <div className="text-[11px] text-white/40 font-bold">CAPITAINE</div>
                      <div className="text-xs font-bold">{fantasySquad.find(p => p.id === fantasyCaptain)?.name.split(' ')[0] || '-'}</div>
                    </div>
                  </div>
                  <button disabled={fantasySquad.length !== 11} className="mt-4 w-full bg-[#22c55e] disabled:opacity-30 text-black font-black py-3 rounded-full">Valider l'équipe</button>
                </div>

                {/* PLAYER POOL */}
                <div className="glass-strong rounded-[24px] p-4">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                      <input value={fantasySearch} onChange={e => setFantasySearch(e.target.value)} placeholder="Rechercher..." className="w-full bg-white/[0.06] border border-white/10 rounded-full pl-9 pr-3 py-2.5 text-sm outline-none placeholder:text-white/30" />
                    </div>
                    <div className="flex bg-[#111b11] border border-white/10 rounded-full p-1">
                      {['Tous', 'ATT', 'MIL', 'DEF', 'GARD'].map(f => (
                        <button key={f} onClick={() => setFantasyFilter(f)} className={`px-3 py-1 rounded-full text-xs font-bold ${fantasyFilter === f ? 'bg-white text-black' : 'text-white/60'}`}>{f}</button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid sm:grid-cols-2 gap-3 max-h-[560px] overflow-y-auto pr-1">
                    {fantasyFiltered.map(p => (
                      <div key={p.id} className="bg-white/[0.04] border border-white/10 rounded-2xl p-3 flex gap-3 hover:bg-white/[0.06]">
                        <img src={p.img} className="w-12 h-12 rounded-xl object-cover" />
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-sm leading-tight">{p.name} <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">{p.pos}</span></div>
                          <div className="text-xs text-white/50">{p.team} • {p.valueStr}</div>
                          <div className="flex gap-1 mt-1">
                            <span className="text-xs bg-[#22c55e] text-black px-2 py-0.5 rounded-full font-bold">{p.rating}</span>
                            <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{p.goals}⚽ {p.assists}🅰️</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <button onClick={() => addFantasy(p)} disabled={fantasyBudgetLeft < p.value || fantasySquad.length >= 11} className="bg-[#22c55e] disabled:opacity-30 text-black p-2 rounded-xl"><Plus size={14} /></button>
                          <button onClick={() => setVersusA(p)} className="bg-white/10 p-2 rounded-xl"><Swords size={14} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* VERSUS */}
          {active === 'versus' && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <h1 className="text-[24px] font-black flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-sky-600 grid place-items-center"><Swords size={18} /></span> Versus — Comparateur Face-à-Face</h1>
                <div className="text-xs bg-white/10 px-3 py-1.5 rounded-full">Sélectionne 2 joueurs pour comparer</div>
              </div>

              <div className="grid lg:grid-cols-2 gap-6">
                {[versusA, versusB].map((p, idx) => (
                  <div key={idx} className="glass-strong rounded-[24px] p-5">
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold tracking-wide text-white/40">{idx === 0 ? 'JOUEUR A' : 'JOUEUR B'}</span>
                      <span className="text-xs bg-violet-600 px-2 py-1 rounded-full">{p.pos}</span>
                    </div>
                    <div className="mt-3 flex gap-4 items-center">
                      <img src={p.img} className="w-16 h-16 rounded-2xl object-cover border-2 border-white/10" />
                      <div className="flex-1">
                        <div className="font-black text-lg leading-none">{p.name}</div>
                        <div className="text-sm text-white/50">{p.team} • {p.age} ans</div>
                        <div className="flex gap-2 mt-2">
                          <span className="text-xs bg-[#22c55e] text-black font-black px-2 py-1 rounded-full">{p.rating} rating</span>
                          <span className="text-xs bg-white/10 px-2 py-1 rounded-full">{p.valueStr}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4">
                      <select value={p.id} onChange={e => {
                        const np = PLAYERS.find(x => x.id === parseInt(e.target.value)) || FANTASY_POOL.find(x => x.id === parseInt(e.target.value))
                        if (np) idx === 0 ? setVersusA(np) : setVersusB(np)
                      }} className="w-full bg-white/[0.06] border border-white/10 rounded-xl px-3 py-2.5 text-sm">
                        {FANTASY_POOL.map(pl => <option key={pl.id} value={pl.id} className="bg-[#0a120a]">{pl.name} — {pl.team}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="glass-strong rounded-[24px] p-6">
                  <h3 className="font-bold">Radar de performance</h3>
                  <div className="h-[320px] mt-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={[
                        { a: 'Vitesse', A: versusA.pace, B: versusB.pace },
                        { a: 'Tir', A: versusA.shoot, B: versusB.shoot },
                        { a: 'Passe', A: versusA.pass, B: versusB.pass },
                        { a: 'Dribble', A: versusA.dribble, B: versusB.dribble },
                        { a: 'Défense', A: versusA.defend, B: versusB.defend },
                        { a: 'Physique', A: versusA.physical, B: versusB.physical },
                      ]}>
                        <PolarGrid stroke="#ffffff15" />
                        <PolarAngleAxis dataKey="a" tick={{ fill: '#fff', fontSize: 11 }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                        <Radar dataKey="A" stroke="#22c55e" fill="#22c55e" fillOpacity={0.3} />
                        <Radar dataKey="B" stroke="#60a5fa" fill="#60a5fa" fillOpacity={0.3} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-4 text-xs">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#22c55e]" /> {versusA.name}</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#60a5fa]" /> {versusB.name}</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="glass-strong rounded-2xl p-5">
                    <h3 className="font-bold">Stats détaillées 24/25</h3>
                    <div className="mt-4 space-y-3">
                      {[
                        { k: 'Buts', a: versusA.goals, b: versusB.goals },
                        { k: 'Passes décisives', a: versusA.assists, b: versusB.assists },
                        { k: 'Note IA', a: versusA.rating, b: versusB.rating },
                        { k: 'Valeur marchande', a: versusA.value, b: versusB.value, suffix: 'M€' },
                      ].map(s => (
                        <div key={s.k} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                          <div className="text-xs font-bold text-white/50 text-center">{s.k}</div>
                          <div className="mt-2 flex items-center gap-2">
                            <div className={`flex-1 text-center py-1.5 rounded-lg font-black ${s.a >= s.b ? 'bg-[#22c55e] text-black' : 'bg-white/10'}`}>{s.a}{s.suffix || ''}</div>
                            <span className="text-white/20">vs</span>
                            <div className={`flex-1 text-center py-1.5 rounded-lg font-black ${s.b >= s.a ? 'bg-[#60a5fa] text-black' : 'bg-white/10'}`}>{s.b}{s.suffix || ''}</div>
                          </div>
                          <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden flex">
                            <div className="bg-[#22c55e]" style={{ width: `${(s.a / (s.a + s.b)) * 100}%` }} />
                            <div className="bg-[#60a5fa] flex-1" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="glass rounded-2xl p-5 bg-gradient-to-br from-[#22c55e]/10 to-transparent border-[#22c55e]/20">
                    <div className="font-bold flex items-center gap-2"><Brain size={16} className="text-[#22c55e]" /> Verdict IA</div>
                    <div className="text-sm text-white/70 mt-2 leading-relaxed">
                      {versusA.rating > versusB.rating
                        ? `${versusA.name} est plus complet (+${versusA.rating - versusB.rating} de rating). Idéal si tu cherches un profil décisif en transition.`
                        : versusA.rating < versusB.rating
                          ? `${versusB.name} domine physiquement et défensivement. Mieux pour un système en pressing haut.`
                          : `Deux profils très proches ! Choisis selon ton système : ${versusA.name} pour la vitesse, ${versusB.name} pour la finition.`}
                    </div>
                    <div className="mt-3 text-xs bg-white text-black font-bold px-3 py-2 rounded-full inline-block">Recommandation : {versusA.rating >= versusB.rating ? versusA.name : versusB.name} ✓</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* API CONNECT */}
          {active === 'api' && (
            <div className="max-w-[900px] space-y-6">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <h1 className="text-[24px] font-black flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-sky-600 grid place-items-center"><Database size={18} /></span> API Connect <span className={`text-xs font-black px-2.5 py-1 rounded-full ${apiStatus === 'success' ? 'bg-[#22c55e] text-black' : 'bg-white/10'}`}>{apiStatus === 'success' ? '● CONNECTÉ' : '○ DÉMO'}</span></h1>
                <a href="https://www.api-football.com/documentation-v3" target="_blank" className="text-xs bg-white text-black px-3 py-1.5 rounded-full font-bold flex items-center gap-1">Docs API <ExternalLink size={12} /></a>
              </div>

              <div className="glass-strong rounded-[24px] p-6">
                <h3 className="font-bold flex items-center gap-2"><Key size={16} className="text-[#22c55e]" /> Configuration de l'API</h3>
                <p className="text-sm text-white/50 mt-1">Connecte une vraie API pour remplacer les données mock par du temps réel. Sans clé, l'app reste en mode démo (TheSportsDB gratuit).</p>

                <div className="mt-5 grid md:grid-cols-[1fr_auto] gap-3">
                  <div>
                    <label className="text-xs font-bold text-white/60">Fournisseur</label>
                    <div className="mt-1 flex gap-2">
                      {[
                        { id: 'demo', label: 'Démo (gratuit)', desc: 'TheSportsDB • pas de clé' },
                        { id: 'api-football', label: 'API-Football', desc: 'api-sports.io • Pro' },
                        { id: 'football-data', label: 'Football-Data', desc: 'football-data.org' },
                      ].map(p => (
                        <button key={p.id} onClick={() => setApiProvider(p.id)} className={`flex-1 text-left p-3 rounded-xl border ${apiProvider === p.id ? 'bg-[#22c55e]/10 border-[#22c55e]/30' : 'bg-white/[0.03] border-white/10'}`}>
                          <div className="text-sm font-bold">{p.label}</div>
                          <div className="text-[11px] text-white/40">{p.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  <label className="text-xs font-bold text-white/60">Clé API {apiProvider !== 'demo' && <span className="text-red-400">*</span>}</label>
                  <div className="mt-1 flex gap-2">
                    <div className="relative flex-1">
                      <Key size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                      <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={apiProvider === 'demo' ? 'Pas nécessaire en mode démo' : 'Colle ta clé API ici...'} disabled={apiProvider === 'demo'} className="w-full bg-white/[0.06] border border-white/10 rounded-full pl-9 pr-3 py-3 text-sm outline-none placeholder:text-white/30 disabled:opacity-50" />
                    </div>
                    <button onClick={fetchApiFixtures} disabled={apiStatus === 'loading'} className="bg-[#22c55e] text-black font-black px-6 py-3 rounded-full flex items-center gap-2 disabled:opacity-60">
                      {apiStatus === 'loading' ? <><span className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> Test...</> : <><Wifi size={16} /> Tester & synchroniser</>}
                    </button>
                  </div>
                  {apiStatus === 'error' && <div className="mt-2 text-xs bg-red-500/10 border border-red-500/20 text-red-300 px-3 py-2 rounded-xl flex gap-2"><AlertCircle size={14} /> {apiError}</div>}
                  {apiStatus === 'success' && <div className="mt-2 text-xs bg-[#22c55e]/10 border border-[#22c55e]/20 text-[#86efac] px-3 py-2 rounded-xl flex gap-2"><CheckCircle2 size={14} /> Connecté ! {apiFixtures.length} matchs récupérés</div>}
                  <div className="mt-2 text-[11px] text-white/30">🔒 Clé stockée localement (localStorage) • jamais envoyée à nos serveurs • Requête directe depuis ton navigateur</div>
                </div>

                <div className="mt-6 p-4 bg-white/[0.04] border border-white/10 rounded-2xl">
                  <div className="font-bold text-sm">Comment obtenir une clé ?</div>
                  <div className="mt-2 grid md:grid-cols-3 gap-3 text-xs">
                    <div className="bg-white/[0.04] rounded-xl p-3">
                      <div className="font-bold">1. TheSportsDB (gratuit)</div>
                      <div className="text-white/50 mt-1">Aucune clé • déjà actif en mode démo</div>
                    </div>
                    <div className="bg-white/[0.04] rounded-xl p-3">
                      <div className="font-bold">2. API-Football</div>
                      <div className="text-white/50 mt-1">api-sports.io → 100 req/jour gratuit</div>
                      <a href="https://dashboard.api-football.com/register" target="_blank" className="text-[#22c55e] font-bold">S'inscrire →</a>
                    </div>
                    <div className="bg-white/[0.04] rounded-xl p-3">
                      <div className="font-bold">3. Football-Data</div>
                      <div className="text-white/50 mt-1">football-data.org → 10 req/min gratuit</div>
                      <a href="https://www.football-data.org/register" target="_blank" className="text-[#22c55e] font-bold">S'inscrire →</a>
                    </div>
                  </div>
                </div>
              </div>

              <div className="glass-strong rounded-[24px] p-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold flex items-center gap-2"><Link2 size={16} className="text-sky-400" /> Données en direct {apiFixtures.length > 0 && <span className="bg-[#22c55e] text-black text-xs px-2 py-0.5 rounded-full">{apiFixtures.length} matchs</span>}</h3>
                  <span className="text-xs text-white/40">{apiProvider === 'demo' ? 'Mode démo (temps réel via TheSportsDB si dispo)' : `Source: ${apiProvider}`}</span>
                </div>

                {apiFixtures.length === 0 ? (
                  <div className="mt-4 text-center py-10">
                    <div className="w-12 h-12 rounded-xl bg-white/5 grid place-items-center mx-auto"><Database size={18} className="text-white/40" /></div>
                    <div className="mt-3 font-bold">Aucune donnée chargée</div>
                    <div className="text-sm text-white/50">Clique sur "Tester & synchroniser" pour charger les matchs</div>
                  </div>
                ) : (
                  <div className="mt-4 grid md:grid-cols-2 gap-3">
                    {apiFixtures.map(f => (
                      <div key={f.id} className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                        <div className="flex justify-between items-start">
                          <div className="font-bold text-sm">{f.home} vs {f.away}</div>
                          <span className="text-[11px] bg-white/10 px-2 py-1 rounded-full">{f.status}</span>
                        </div>
                        <div className="text-xs text-white/50 mt-1">{f.league} • {new Date(f.date).toLocaleString('fr-FR')}</div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 bg-sky-500/10 border border-sky-500/20 rounded-xl p-3 text-xs text-sky-200">
                  <span className="font-bold">💡 Code d'intégration :</span> Les requêtes sont faites en direct depuis le navigateur avec <code className="bg-white/10 px-1.5 py-0.5 rounded">fetch()</code> + clé en header. Aucun backend nécessaire. Voir l'onglet réseau (F12) pour inspecter les appels.
                </div>
              </div>
            </div>
          )}

          {/* CHAT */}
          {active === 'chat' && (
            <div className="grid lg:grid-cols-[320px_1fr] gap-6 h-[calc(100vh-128px)] min-h-[560px]">
              <div className="glass-strong rounded-2xl p-4 hidden lg:flex flex-col">
                <h3 className="font-black flex items-center gap-2"><Bot size={16} className="text-[#22c55e]" /> Prompts rapides</h3>
                <p className="text-xs text-white/50 mt-1">Clique pour tester l'IA</p>
                <div className="mt-4 space-y-2">
                  {[
                    'Analyse le 4-3-3 du PSG',
                    'Prédiction Real vs City ?',
                    'Stats détaillées de Mbappé',
                    'Meilleur jeune à scoutter ?',
                    'Pourquoi le PSG encaisse sur CPA ?',
                  ].map(q => (
                    <button key={q} onClick={() => setChatInput(q)} className="w-full text-left bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-xl px-3 py-3 text-sm">
                      <span className="text-[#22c55e]">›</span> {q}
                    </button>
                  ))}
                </div>
                <div className="mt-auto bg-gradient-to-br from-[#102a12] to-[#0a1f0b] border border-[#22c55e]/20 rounded-2xl p-4">
                  <div className="text-sm font-bold">Besoin d'analyse vidéo ?</div>
                  <div className="text-xs text-white/50 mt-1">Upload un clip et l'IA détecte pressing, transitions, erreurs.</div>
                  <button onClick={() => setActive('video')} className="mt-3 w-full bg-violet-600 text-white font-bold py-2 rounded-xl text-sm">Uploader une vidéo</button>
                </div>
              </div>

              <div className="glass-strong rounded-2xl flex flex-col overflow-hidden">
                <div className="h-[56px] px-4 flex items-center gap-3 border-b border-white/10 shrink-0">
                  <div className="w-9 h-9 rounded-full bg-[#22c55e] grid place-items-center text-black"><Bot size={18} /></div>
                  <div>
                    <div className="font-bold leading-none">FootballAI Assistant</div>
                    <div className="text-xs text-[#22c55e] font-semibold">● En ligne • Répond en &lt; 1s</div>
                  </div>
                  <div className="ml-auto hidden sm:flex items-center gap-2">
                    <span className="text-xs bg-white/10 px-2.5 py-1 rounded-full">Modèle v4.2</span>
                    <button onClick={() => setChatMsgs([{ role: 'bot', text: 'Nouveau chat ! Pose-moi ta question ⚽️' }])} className="text-xs bg-white text-black px-3 py-1.5 rounded-full font-bold flex items-center gap-1"><RotateCcw size={12} /> Reset</button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#080c08]/50">
                  {chatMsgs.map((m, i) => (
                    <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : ''}`}>
                      {m.role === 'bot' && <div className="w-8 h-8 rounded-full bg-[#1a2a1a] border border-white/10 grid place-items-center shrink-0"><Bot size={14} /></div>}
                      <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap ${m.role === 'bot' ? 'bg-[#111b11] border border-white/10' : 'bg-[#22c55e] text-black font-medium'}`}>{m.text}</div>
                      {m.role === 'user' && <div className="w-8 h-8 rounded-full bg-white text-black grid place-items-center shrink-0"><User size={14} /></div>}
                    </div>
                  ))}
                  {chatTyping && (
                    <div className="flex gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#1a2a1a] border border-white/10 grid place-items-center"><Bot size={14} /></div>
                      <div className="bg-[#111b11] border border-white/10 rounded-2xl px-4 py-3 flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce" />
                        <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:120ms]" />
                        <span className="w-1.5 h-1.5 bg-white/60 rounded-full animate-bounce [animation-delay:240ms]" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="p-3 border-t border-white/10 bg-[#0a120a]">
                  <div className="flex gap-2">
                    <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} placeholder="Pose ta question... ex: 'Analyse le pressing de City'" className="flex-1 bg-white/[0.06] border border-white/10 rounded-full px-4 py-3 text-sm outline-none placeholder:text-white/30 focus:border-[#22c55e]/50" />
                    <button onClick={sendChat} className="w-11 h-11 rounded-full bg-[#22c55e] text-black grid place-items-center shrink-0 hover:bg-[#16a34a]"><Send size={16} /></button>
                  </div>
                  <div className="text-[11px] text-white/30 mt-2 text-center">L'IA peut faire des erreurs. Vérifie les infos importantes.</div>
                </div>
              </div>
            </div>
          )}

          {/* TACTICS */}
          {active === 'tactics' && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <h1 className="text-[24px] font-black flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-orange-500 grid place-items-center"><MapPinned size={18} /></span> Tableau Tactique</h1>
                <div className="flex items-center gap-2">
                  <div className="flex bg-[#111b11] border border-white/10 rounded-full p-1">
                    {Object.keys(FORMATIONS).map(f => (
                      <button key={f} onClick={() => setFormation(f)} className={`px-4 py-1.5 rounded-full text-sm font-bold ${formation === f ? 'bg-white text-black' : 'text-white/60'}`}>{f}</button>
                    ))}
                  </div>
                  <button onClick={() => setShowHeatmap(!showHeatmap)} className={`px-4 py-2 rounded-full text-sm font-bold border ${showHeatmap ? 'bg-[#22c55e] text-black border-[#22c55e]' : 'bg-white/10 border-white/10 text-white'}`}><Flame size={14} className="inline mr-1" /> Heatmap</button>
                </div>
              </div>

              <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6">
                <div className="glass-strong rounded-[24px] p-4 lg:p-6">
                  <div className="relative w-full aspect-[4/5] max-h-[560px] mx-auto bg-gradient-to-b from-[#1a6b1a] to-[#0f4d0f] rounded-2xl overflow-hidden border border-white/10 p-3">
                    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-40">
                      <rect x="2" y="2" width="96" height="96" fill="none" stroke="white" strokeWidth="0.6" rx="1" />
                      <line x1="2" y1="50" x2="98" y2="50" stroke="white" strokeWidth="0.5" />
                      <circle cx="50" cy="50" r="9" fill="none" stroke="white" strokeWidth="0.5" />
                      <rect x="22" y="2" width="56" height="16" fill="none" stroke="white" strokeWidth="0.5" />
                      <rect x="32" y="2" width="36" height="6" fill="none" stroke="white" strokeWidth="0.5" />
                      <rect x="22" y="82" width="56" height="16" fill="none" stroke="white" strokeWidth="0.5" />
                      <rect x="32" y="92" width="36" height="6" fill="none" stroke="white" strokeWidth="0.5" />
                      <circle cx="50" cy="11" r="0.8" fill="white" />
                      <circle cx="50" cy="89" r="0.8" fill="white" />
                    </svg>
                    {showHeatmap && (
                      <div className="absolute inset-3 rounded-xl overflow-hidden opacity-60">
                        <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 30% 30%, rgba(239,68,68,0.5), transparent 50%), radial-gradient(ellipse at 70% 50%, rgba(34,197,94,0.45), transparent 45%), radial-gradient(ellipse at 50% 80%, rgba(59,130,246,0.35), transparent 40%)' }} />
                      </div>
                    )}
                    {FORMATIONS[formation].map((p, i) => (
                      <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1" style={{ left: `${p.x}%`, top: `${p.y}%` }}>
                        <div className="w-9 h-9 lg:w-10 lg:h-10 rounded-full bg-white text-black grid place-items-center font-black text-[11px] shadow-lg border-2 border-[#22c55e]">{p.n}</div>
                        <div className="text-[10px] font-bold bg-black/60 px-1.5 py-0.5 rounded-full backdrop-blur">{p.n}</div>
                      </div>
                    ))}
                    <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur px-3 py-1.5 rounded-full text-xs font-bold flex items-center gap-2">
                      <span className="w-2 h-2 bg-[#22c55e] rounded-full animate-pulse" /> {formation} • Pressing haut
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3">
                    {[
                      { k: 'Largeur', v: '68%', d: 'étire le bloc adverse' },
                      { k: 'Hauteur', v: '42m', d: 'ligne défensive haute' },
                      { k: 'Densité', v: '7.1', d: 'joueurs / 100m²' },
                    ].map(s => (
                      <div key={s.k} className="bg-white/[0.04] border border-white/10 rounded-xl p-3 text-center">
                        <div className="text-[11px] font-bold tracking-wide text-white/40">{s.k}</div>
                        <div className="text-lg font-black">{s.v}</div>
                        <div className="text-[11px] text-white/40">{s.d}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="glass-strong rounded-2xl p-5">
                    <h3 className="font-bold flex items-center gap-2"><Gauge size={16} className="text-[#22c55e]" /> Analyse IA du dispositif</h3>
                    <div className="mt-4 space-y-3 text-sm leading-relaxed">
                      <div className="bg-[#22c55e]/10 border border-[#22c55e]/20 rounded-xl p-3">
                        <div className="font-bold text-[#86efac]">✅ Forces</div>
                        <div className="text-white/70 text-xs mt-1">Excellente occupation de la largeur. Les ailiers fixent les latéraux, créant des intervalles pour les 8. Idéal contre bloc bas.</div>
                      </div>
                      <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3">
                        <div className="font-bold text-orange-300">⚠️ Vulnérabilité</div>
                        <div className="text-white/70 text-xs mt-1">Espace dans le dos des latéraux si perte haute. Recommandation : 6 en couverture + inversion d'un latéral.</div>
                      </div>
                      <div className="bg-white/[0.04] border border-white/10 rounded-xl p-3">
                        <div className="font-bold">💡 Conseil IA</div>
                        <div className="text-white/60 text-xs mt-1">Contre un 4-4-2, fais monter le 8 droit entre les lignes. Taux de réussite +18% sur les 3e homme.</div>
                      </div>
                    </div>
                    <button className="mt-4 w-full bg-white text-black font-bold py-2.5 rounded-xl text-sm">Exporter en PDF</button>
                  </div>
                  <div className="glass rounded-2xl p-5">
                    <h4 className="font-bold text-sm">Phases à travailler</h4>
                    <div className="mt-3 space-y-2">
                      {[
                        { n: 'Sortie de balle', p: 82 },
                        { n: 'Pressing à 3', p: 74 },
                        { n: 'Coup franc indirect', p: 61 },
                      ].map(x => (
                        <div key={x.n} className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="flex justify-between text-xs"><span>{x.n}</span><span className="font-bold">{x.p}%</span></div>
                            <div className="h-1.5 bg-white/10 rounded-full mt-1 overflow-hidden"><div className="h-full bg-[#22c55e]" style={{ width: `${x.p}%` }} /></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* LIVE */}
          {active === 'live' && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <h1 className="text-[24px] font-black flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-red-500 grid place-items-center"><Radio size={18} /></span> Live Center <span className="bg-red-500 text-white text-xs font-black px-2.5 py-1 rounded-full animate-pulse">4 MATCHS LIVE</span></h1>
                <div className="flex items-center gap-2">
                  <button onClick={() => setLivePlaying(!livePlaying)} className={`px-4 py-2 rounded-full text-sm font-bold flex items-center gap-2 ${livePlaying ? 'bg-white text-black' : 'bg-white/10 text-white'}`}>
                    {livePlaying ? <Pause size={14} /> : <Play size={14} />} {livePlaying ? 'En direct' : 'Reprendre'}
                  </button>
                  <span className="text-xs text-white/40 hidden sm:inline">Mise à jour auto • xG live par Opta</span>
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                {liveMatches.map(m => (
                  <div key={m.id} className="glass-strong rounded-[20px] p-5 relative overflow-hidden">
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-red-500 via-orange-500 to-[#22c55e]" />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold tracking-wide bg-red-500 text-white px-2.5 py-1 rounded-full flex items-center gap-1.5"><span className="w-1.5 h-1.5 bg-white rounded-full animate-ping" /> {m.minute}' • LIVE</span>
                      <span className="text-xs text-white/40 flex items-center gap-1"><Timer size={12} /> {m.minute}’ • 2e mi-temps</span>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="text-center flex-1">
                        <div className="w-12 h-12 rounded-2xl bg-white text-black grid place-items-center font-black mx-auto">{m.home.slice(0, 3).toUpperCase()}</div>
                        <div className="font-black mt-2 text-sm">{m.home}</div>
                        <div className="text-xs text-white/40">Domicile</div>
                      </div>
                      <div className="text-center px-4">
                        <div className="text-[30px] font-black leading-none">{m.hScore} - {m.aScore}</div>
                        <div className="text-[11px] bg-white/10 px-2 py-1 rounded-full mt-2">xG {m.xgH} - {m.xgA} xG</div>
                      </div>
                      <div className="text-center flex-1">
                        <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 grid place-items-center font-black mx-auto">{m.away.slice(0, 3).toUpperCase()}</div>
                        <div className="font-black mt-2 text-sm">{m.away}</div>
                        <div className="text-xs text-white/40">Extérieur</div>
                      </div>
                    </div>
                    <div className="mt-4 h-1.5 bg-white/10 rounded-full overflow-hidden flex">
                      <div className="bg-[#22c55e]" style={{ width: `${(m.xgH / (m.xgH + m.xgA)) * 100}%` }} />
                      <div className="bg-white/30 flex-1" />
                    </div>
                    <div className="flex justify-between text-[11px] text-white/40 mt-1"><span>Momentum domicile</span><span>Extérieur</span></div>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {m.events.map((e, i) => (
                        <span key={i} className="text-xs bg-white/[0.06] border border-white/10 px-2.5 py-1 rounded-full">{e}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="glass rounded-2xl p-5">
                <h3 className="font-bold flex items-center gap-2"><Activity size={16} className="text-[#22c55e]" /> Prochains matchs à suivre</h3>
                <div className="mt-4 grid md:grid-cols-3 gap-3">
                  {[
                    { h: 'Liverpool', a: 'Chelsea', t: '20:45 • Auj.' },
                    { h: 'Inter', a: 'Milan', t: '18:30 • Demain' },
                    { h: 'Barça', a: 'Atletico', t: '21:00 • Dim.' },
                  ].map(x => (
                    <div key={x.h} className="bg-white/[0.04] border border-white/10 rounded-xl p-3 flex items-center justify-between">
                      <div className="text-sm font-semibold">{x.h} vs {x.a}</div>
                      <span className="text-xs bg-white text-black px-2 py-1 rounded-full font-bold">{x.t}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* SCOUT */}
          {active === 'scout' && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <h1 className="text-[24px] font-black flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-violet-600 grid place-items-center"><Search size={18} /></span> Scout Lab <span className="text-xs bg-violet-600 px-2.5 py-1 rounded-full">IA • 3 842 profils</span></h1>
                <div className="flex gap-2">
                  <div className="flex bg-[#111b11] border border-white/10 rounded-full p-1">
                    {['Tous', 'ATT', 'MIL', 'DEF'].map(p => (
                      <button key={p} onClick={() => setScoutPos(p)} className={`px-3 py-1.5 rounded-full text-xs font-bold ${scoutPos === p ? 'bg-white text-black' : 'text-white/60'}`}>{p}</button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40" />
                <input value={scoutQ} onChange={e => setScoutQ(e.target.value)} placeholder="Rechercher un joueur, équipe, poste..." className="w-full bg-white/[0.06] border border-white/10 rounded-full pl-10 pr-4 py-3.5 text-sm outline-none placeholder:text-white/30 focus:border-violet-500/50" />
              </div>

              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredPlayers.map(p => (
                  <div key={p.id} className="glass-strong rounded-[20px] p-4 hover:bg-white/[0.06] transition cursor-pointer" onClick={() => setSelectedPlayer(p)}>
                    <div className="flex gap-3">
                      <img src={p.img} className="w-14 h-14 rounded-2xl object-cover border border-white/10" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold leading-tight">{p.name} <span className="inline-flex ml-1 text-[11px] bg-[#22c55e] text-black px-1.5 py-0.5 rounded-full font-black">{p.pos}</span></div>
                        <div className="text-xs text-white/50">{p.team} • {p.age} ans</div>
                        <div className="flex gap-1 mt-1">
                          <span className="text-xs bg-white text-black px-2 py-0.5 rounded-full font-bold">{p.rating}</span>
                          <span className="text-xs bg-white/10 px-2 py-0.5 rounded-full">{p.valueStr}</span>
                        </div>
                      </div>
                      <ArrowUpRight size={16} className="text-white/30" />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {[
                        { k: 'PAC', v: p.pace }, { k: 'SHO', v: p.shoot }, { k: 'PHY', v: p.physical },
                      ].map(s => (
                        <div key={s.k} className="bg-white/[0.04] border border-white/10 rounded-xl p-2 text-center">
                          <div className="text-[11px] text-white/40 font-bold">{s.k}</div>
                          <div className="font-black">{s.v}</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-white/50"><Star size={12} className="text-yellow-400" /> Recommandé par l'IA • Fit 92%</div>
                  </div>
                ))}
              </div>

              {selectedPlayer && (
                <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedPlayer(null)}>
                  <div onClick={e => e.stopPropagation()} className="w-full max-w-[760px] bg-[#0c120c] border border-white/10 rounded-[24px] overflow-hidden max-h-[90vh] overflow-y-auto">
                    <div className="h-28 bg-gradient-to-r from-violet-600 to-indigo-600 relative p-6 flex items-end">
                      <button onClick={() => setSelectedPlayer(null)} className="absolute top-4 right-4 w-9 h-9 rounded-full bg-black/20 backdrop-blur grid place-items-center"><X size={16} /></button>
                      <div className="flex gap-4 items-end">
                        <img src={selectedPlayer.img} className="w-20 h-20 rounded-2xl border-2 border-white object-cover" />
                        <div>
                          <div className="text-xl font-black">{selectedPlayer.name}</div>
                          <div className="text-white/80 text-sm">{selectedPlayer.team} • {selectedPlayer.pos} • {selectedPlayer.age} ans</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-6 grid md:grid-cols-2 gap-6">
                      <div>
                        <h4 className="font-bold">Radar de performance</h4>
                        <div className="h-[260px] mt-2">
                          <ResponsiveContainer width="100%" height="100%">
                            <RadarChart data={[
                              { a: 'Vitesse', v: selectedPlayer.pace },
                              { a: 'Tir', v: selectedPlayer.shoot },
                              { a: 'Passe', v: selectedPlayer.pass },
                              { a: 'Dribble', v: selectedPlayer.dribble },
                              { a: 'Défense', v: selectedPlayer.defend },
                              { a: 'Physique', v: selectedPlayer.physical },
                            ]}>
                              <PolarGrid stroke="#ffffff15" />
                              <PolarAngleAxis dataKey="a" tick={{ fill: '#fff', fontSize: 11 }} />
                              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                              <Radar dataKey="v" stroke="#22c55e" fill="#22c55e" fillOpacity={0.35} />
                            </RadarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { k: 'Note IA', v: `${selectedPlayer.rating}/100` },
                            { k: 'Valeur', v: selectedPlayer.valueStr },
                            { k: 'Potentiel', v: '95' },
                          ].map(s => (
                            <div key={s.k} className="bg-white/[0.05] border border-white/10 rounded-xl p-3 text-center">
                              <div className="text-[11px] text-white/40 font-bold">{s.k}</div>
                              <div className="font-black">{s.v}</div>
                            </div>
                          ))}
                        </div>
                        <div className="bg-[#22c55e]/10 border border-[#22c55e]/20 rounded-xl p-3 text-sm">
                          <div className="font-bold text-[#86efac]">Verdict IA</div>
                          <div className="text-white/70 text-xs mt-1 leading-relaxed">Profil explosif, excellent en transition. Idéal pour un système en pressing haut avec attaques rapides. Risque blessure faible.</div>
                        </div>
                        <button className="w-full bg-white text-black font-bold py-3 rounded-xl">Ajouter à ma shortlist</button>
                        <button onClick={() => { setVersusA(selectedPlayer); setActive('versus'); setSelectedPlayer(null) }} className="w-full bg-violet-600 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"><Swords size={14} /> Comparer en Versus</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SETTINGS */}
          {active === 'settings' && (
            <div className="max-w-[900px] space-y-6">
              <div>
                <h1 className="text-[24px] font-black flex items-center gap-3"><span className="w-9 h-9 rounded-xl bg-white text-black grid place-items-center"><Settings size={18} /></span> Gérer les options</h1>
                <p className="text-white/50 text-sm mt-1">Active ou désactive les modules • {Object.values(enabled).filter(Boolean).length}/10 actifs</p>
              </div>

              <div className="glass-strong rounded-[24px] p-6">
                <h3 className="font-bold">Modules disponibles</h3>
                <p className="text-xs text-white/40">Clique pour activer/désactiver</p>
                <div className="mt-5 grid sm:grid-cols-2 gap-3">
                  {[
                    { id: 'dashboard', title: 'Dashboard', desc: 'Vue d’ensemble, KPIs, momentum xG', icon: LayoutDashboard },
                    { id: 'predictor', title: 'Prédicteur IA', desc: 'Prédictions, probas, xG, score exact', icon: Zap },
                    { id: 'video', title: 'Vidéo IA', desc: 'Upload & analyse auto YOLOv8', icon: Video },
                    { id: 'live', title: 'Live Center', desc: 'Scores en direct + xG live', icon: Radio },
                    { id: 'fantasy', title: 'Fantasy Lab', desc: 'Draft 11 joueurs + capitaine', icon: Crown },
                    { id: 'versus', title: 'Versus', desc: 'Comparateur face-à-face radar', icon: Swords },
                    { id: 'chat', title: 'Assistant IA', desc: 'Chat football intelligent 24/7', icon: MessageCircle },
                    { id: 'tactics', title: 'Tableau Tactique', desc: 'Terrain interactif, formations, heatmap', icon: MapPinned },
                    { id: 'scout', title: 'Scout Lab', desc: 'Base joueurs + radar + recommandations', icon: Search },
                    { id: 'api', title: 'API Connect', desc: 'Connecte API-Football / TheSportsDB', icon: Database },
                  ].map(m => (
                    <div key={m.id} className={`flex gap-3 p-4 rounded-2xl border transition ${enabled[m.id] ? 'bg-[#22c55e]/10 border-[#22c55e]/30' : 'bg-white/[0.03] border-white/10 opacity-60'}`}>
                      <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${enabled[m.id] ? 'bg-[#22c55e] text-black' : 'bg-white/10 text-white/60'}`}><m.icon size={16} /></div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm">{m.title}</div>
                        <div className="text-xs text-white/50 leading-tight">{m.desc}</div>
                      </div>
                      <button onClick={() => setEnabled(e => ({ ...e, [m.id]: !e[m.id] }))} className={`shrink-0 w-12 h-7 rounded-full p-1 transition flex items-center ${enabled[m.id] ? 'bg-[#22c55e] justify-end' : 'bg-white/20 justify-start'}`}>
                        <span className="w-5 h-5 bg-white rounded-full shadow" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="mt-6 grid md:grid-cols-3 gap-3">
                  <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                    <div className="text-sm font-bold">Thème</div>
                    <div className="mt-2 flex gap-2">
                      <span className="px-3 py-1.5 rounded-full bg-[#22c55e] text-black text-xs font-bold">Sombre Pro ✓</span>
                      <span className="px-3 py-1.5 rounded-full bg-white/10 text-white/50 text-xs">Clair</span>
                    </div>
                  </div>
                  <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                    <div className="text-sm font-bold">Notifications</div>
                    <button onClick={() => setNotifications(!notifications)} className={`mt-2 px-3 py-1.5 rounded-full text-xs font-bold ${notifications ? 'bg-[#22c55e] text-black' : 'bg-white/10 text-white/60'}`}>{notifications ? 'Activées • Live + pronos' : 'Désactivées'}</button>
                  </div>
                  <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-4">
                    <div className="text-sm font-bold">Langue</div>
                    <div className="mt-2 text-xs bg-white text-black px-3 py-1.5 rounded-full inline-block font-bold">Français • FR</div>
                  </div>
                </div>
              </div>

              <div className="glass rounded-2xl p-6">
                <h3 className="font-bold">Toutes les options sont débloquées ! 🎉</h3>
                <div className="mt-4 grid sm:grid-cols-3 gap-3">
                  {[
                    { t: 'Analyse vidéo IA', d: 'Upload → détection YOLOv8', tag: '✓ Live' },
                    { t: 'Fantasy League', d: 'Draft + capitaine + projection', tag: '✓ Live' },
                    { t: 'Versus', d: 'Radar + barres + verdict IA', tag: '✓ Live' },
                    { t: 'API Connect', d: 'TheSportsDB + API-Football', tag: '✓ Live' },
                    { t: 'Export PDF/CSV', d: 'Rapports tactiques', tag: 'Pro' },
                    { t: 'Alertes Discord', d: 'Webhook buts & xG', tag: 'Bientôt' },
                  ].map(o => (
                    <div key={o.t} className="bg-white/[0.04] border border-white/10 rounded-xl p-4 flex gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#22c55e]/20 text-[#22c55e] grid place-items-center shrink-0"><Check size={14} /></div>
                      <div className="flex-1">
                        <div className="font-semibold text-sm flex items-center gap-2">{o.t} <span className={`text-[10px] px-2 py-0.5 rounded-full ${o.tag.includes('Live') ? 'bg-[#22c55e] text-black' : 'bg-white/10'}`}>{o.tag}</span></div>
                        <div className="text-xs text-white/50">{o.d}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="h-8" />
        </main>
      </div>
    </div>
  )
}

function TeamPicker({ team, onSelect, label }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <div className="text-[11px] font-bold tracking-wide text-white/40 text-center mb-2">{label}</div>
      <button onClick={() => setOpen(!open)} className="w-full bg-white/[0.06] border border-white/10 rounded-2xl p-3 flex flex-col items-center gap-2 hover:bg-white/[0.08]">
        <div className="w-14 h-14 rounded-2xl bg-white text-black grid place-items-center text-xl font-black">{team.logo}</div>
        <div className="font-black text-sm">{team.short}</div>
        <div className="text-xs text-white/50">{team.name}</div>
        <div className="text-[11px] bg-white/10 px-2 py-1 rounded-full">{team.rating} rating</div>
      </button>
      {open && (
        <div className="absolute z-20 mt-2 left-0 right-0 bg-[#0f1a0f] border border-white/15 rounded-2xl overflow-hidden shadow-2xl max-h-[260px] overflow-y-auto">
          {TEAMS.map(t => (
            <button key={t.id} onClick={() => { onSelect(t); setOpen(false) }} className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-white/10 text-left">
              <span className="w-8 h-8 rounded-lg bg-white text-black grid place-items-center text-sm">{t.logo}</span>
              <span className="flex-1 text-sm font-semibold">{t.name}</span>
              <span className="text-xs bg-white/10 px-2 py-1 rounded-full">{t.rating}</span>
              {team.id === t.id && <Check size={14} className="text-[#22c55e]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// BASE DE DONNÉES STATISTIQUE DES CHAMPIONNATS & ÉQUIPES
// Priors calibrés sur les moyennes multi-saisons (Elo + xG)
// ============================================================

export const LEAGUES = {
  ligue1: {
    name: "Ligue 1 🇫🇷",
    shortName: "Ligue 1",
    flag: "🇫🇷",
    color: "#00a0e9",
    avgHomeGoals: 1.56,
    avgAwayGoals: 1.24,
    homeWinRate: 0.445,
    drawRate: 0.255,
    awayWinRate: 0.30,
    eloHomeAdv: 64,
    rho: -0.11,
    featuredMatches: [
      ["PSG", "Marseille"],
      ["Monaco", "Lyon"],
      ["Lille", "Nice"],
      ["Lens", "Rennes"],
    ],
  },
  premier: {
    name: "Premier League 🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    shortName: "Premier League",
    flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    color: "#8b5cf6",
    avgHomeGoals: 1.64,
    avgAwayGoals: 1.33,
    homeWinRate: 0.455,
    drawRate: 0.235,
    awayWinRate: 0.31,
    eloHomeAdv: 62,
    rho: -0.10,
    featuredMatches: [
      ["Liverpool", "Arsenal"],
      ["Manchester City", "Chelsea"],
      ["Newcastle", "Aston Villa"],
      ["Tottenham", "Manchester United"],
    ],
  },
  liga: {
    name: "La Liga 🇪🇸",
    shortName: "La Liga",
    flag: "🇪🇸",
    color: "#ee8707",
    avgHomeGoals: 1.49,
    avgAwayGoals: 1.14,
    homeWinRate: 0.46,
    drawRate: 0.265,
    awayWinRate: 0.275,
    eloHomeAdv: 66,
    rho: -0.12,
    featuredMatches: [
      ["Real Madrid", "FC Barcelone"],
      ["Atlético Madrid", "Athletic Bilbao"],
      ["Villarreal", "Real Sociedad"],
      ["Real Betis", "Séville"],
    ],
  },
  bundesliga: {
    name: "Bundesliga 🇩🇪",
    shortName: "Bundesliga",
    flag: "🇩🇪",
    color: "#ef4444",
    avgHomeGoals: 1.74,
    avgAwayGoals: 1.40,
    homeWinRate: 0.45,
    drawRate: 0.24,
    awayWinRate: 0.31,
    eloHomeAdv: 60,
    rho: -0.09,
    featuredMatches: [
      ["Bayern Munich", "Bayer Leverkusen"],
      ["Borussia Dortmund", "RB Leipzig"],
      ["Eintracht Francfort", "Stuttgart"],
      ["Fribourg", "Wolfsburg"],
    ],
  },
  seriea: {
    name: "Serie A 🇮🇹",
    shortName: "Serie A",
    flag: "🇮🇹",
    color: "#0ea5e9",
    avgHomeGoals: 1.48,
    avgAwayGoals: 1.18,
    homeWinRate: 0.44,
    drawRate: 0.27,
    awayWinRate: 0.29,
    eloHomeAdv: 63,
    rho: -0.12,
    featuredMatches: [
      ["Inter Milan", "Naples"],
      ["Juventus", "AC Milan"],
      ["Atalanta", "AS Rome"],
      ["Lazio", "Fiorentina"],
    ],
  },
  ucl: {
    name: "Champions League 🇪🇺",
    shortName: "Champions League",
    flag: "🇪🇺",
    color: "#38bdf8",
    avgHomeGoals: 1.66,
    avgAwayGoals: 1.34,
    homeWinRate: 0.46,
    drawRate: 0.225,
    awayWinRate: 0.315,
    eloHomeAdv: 58,
    rho: -0.09,
    featuredMatches: [
      ["Real Madrid", "Manchester City"],
      ["PSG", "Liverpool"],
      ["FC Barcelone", "Bayern Munich"],
      ["Inter Milan", "Arsenal"],
    ],
  },
  europa: {
    name: "Europa League 🟠",
    shortName: "Europa League",
    flag: "🟠",
    color: "#fb923c",
    avgHomeGoals: 1.61,
    avgAwayGoals: 1.28,
    homeWinRate: 0.455,
    drawRate: 0.24,
    awayWinRate: 0.305,
    eloHomeAdv: 60,
    rho: -0.10,
    featuredMatches: [
      ["Lyon", "Manchester United"],
      ["Lazio", "Athletic Bilbao"],
      ["Eintracht Francfort", "Tottenham"],
      ["AS Rome", "FC Porto"],
    ],
  },
  international: {
    name: "Sélections / CAN & Mondial 🌍",
    shortName: "International",
    flag: "🌍",
    color: "#10b981",
    avgHomeGoals: 1.44,
    avgAwayGoals: 1.10,
    homeWinRate: 0.45,
    drawRate: 0.275,
    awayWinRate: 0.275,
    eloHomeAdv: 52,
    rho: -0.12,
    featuredMatches: [
      ["Côte d'Ivoire", "Maroc"],
      ["Sénégal", "Nigeria"],
      ["France", "Espagne"],
      ["Argentine", "Brésil"],
    ],
  },
};

// atk > 1.0 = attaque prolifique ; def < 1.0 = défense solide (concède moins de xG)
export const CLUBS_DB = [
  // ================= LIGUE 1 =================
  { name: "PSG", fullName: "Paris Saint-Germain", leagues: ["ligue1", "ucl"], elo: 1965, atk: 1.48, def: 0.74, aliases: ["paris", "paris sg", "paris saint-germain", "paris saint germain"] },
  { name: "Monaco", fullName: "AS Monaco", leagues: ["ligue1", "ucl"], elo: 1795, atk: 1.24, def: 0.90, aliases: ["as monaco", "asm"] },
  { name: "Marseille", fullName: "Olympique de Marseille", leagues: ["ligue1", "ucl"], elo: 1790, atk: 1.25, def: 0.91, aliases: ["om", "olympique de marseille", "olympique marseille"] },
  { name: "Lille", fullName: "LOSC Lille", leagues: ["ligue1", "ucl"], elo: 1785, atk: 1.16, def: 0.84, aliases: ["losc", "losc lille"] },
  { name: "Lyon", fullName: "Olympique Lyonnais", leagues: ["ligue1"], elo: 1755, atk: 1.18, def: 0.95, aliases: ["ol", "olympique lyonnais"] },
  { name: "Nice", fullName: "OGC Nice", leagues: ["ligue1"], elo: 1745, atk: 1.12, def: 0.88, aliases: ["ogc nice", "ogcn"] },
  { name: "Lens", fullName: "RC Lens", leagues: ["ligue1"], elo: 1740, atk: 1.08, def: 0.87, aliases: ["rc lens", "rcl"] },
  { name: "Strasbourg", fullName: "RC Strasbourg", leagues: ["ligue1"], elo: 1715, atk: 1.11, def: 0.98, aliases: ["rc strasbourg", "rcsa"] },
  { name: "Rennes", fullName: "Stade Rennais", leagues: ["ligue1"], elo: 1710, atk: 1.09, def: 0.99, aliases: ["stade rennais", "srfc"] },
  { name: "Brest", fullName: "Stade Brestois 29", leagues: ["ligue1", "ucl"], elo: 1708, atk: 1.07, def: 0.98, aliases: ["stade brestois", "sb29"] },
  { name: "Toulouse", fullName: "Toulouse FC", leagues: ["ligue1"], elo: 1690, atk: 1.02, def: 0.99, aliases: ["tfc", "toulouse fc"] },
  { name: "Paris FC", fullName: "Paris FC", leagues: ["ligue1"], elo: 1665, atk: 0.97, def: 1.04, aliases: ["pfc"] },
  { name: "Auxerre", fullName: "AJ Auxerre", leagues: ["ligue1"], elo: 1660, atk: 0.98, def: 1.07, aliases: ["aja", "aj auxerre"] },
  { name: "Nantes", fullName: "FC Nantes", leagues: ["ligue1"], elo: 1650, atk: 0.93, def: 1.06, aliases: ["fc nantes", "fcn"] },
  { name: "Reims", fullName: "Stade de Reims", leagues: ["ligue1"], elo: 1648, atk: 0.95, def: 1.06, aliases: ["stade de reims"] },
  { name: "Lorient", fullName: "FC Lorient", leagues: ["ligue1"], elo: 1645, atk: 0.96, def: 1.08, aliases: ["fc lorient", "fcl"] },
  { name: "Angers", fullName: "Angers SCO", leagues: ["ligue1"], elo: 1630, atk: 0.89, def: 1.11, aliases: ["angers sco", "sco"] },
  { name: "Le Havre", fullName: "Le Havre AC", leagues: ["ligue1"], elo: 1622, atk: 0.87, def: 1.13, aliases: ["hac", "le havre ac"] },
  { name: "Metz", fullName: "FC Metz", leagues: ["ligue1"], elo: 1618, atk: 0.88, def: 1.14, aliases: ["fc metz"] },
  { name: "Saint-Étienne", fullName: "AS Saint-Étienne", leagues: ["ligue1"], elo: 1625, atk: 0.91, def: 1.14, aliases: ["asse", "saint etienne", "st etienne"] },
  { name: "Montpellier", fullName: "Montpellier HSC", leagues: ["ligue1"], elo: 1615, atk: 0.90, def: 1.16, aliases: ["mhsc"] },

  // ================= PREMIER LEAGUE =================
  { name: "Liverpool", fullName: "Liverpool FC", leagues: ["premier", "ucl"], elo: 1990, atk: 1.44, def: 0.72, aliases: ["lfc", "liverpool fc"] },
  { name: "Arsenal", fullName: "Arsenal FC", leagues: ["premier", "ucl"], elo: 1982, atk: 1.38, def: 0.69, aliases: ["afc", "gunners", "arsenal fc"] },
  { name: "Manchester City", fullName: "Manchester City FC", leagues: ["premier", "ucl"], elo: 1968, atk: 1.45, def: 0.77, aliases: ["man city", "city", "mcfc"] },
  { name: "Chelsea", fullName: "Chelsea FC", leagues: ["premier", "ucl"], elo: 1878, atk: 1.28, def: 0.86, aliases: ["cfc", "blues", "chelsea fc"] },
  { name: "Newcastle", fullName: "Newcastle United", leagues: ["premier", "ucl"], elo: 1860, atk: 1.24, def: 0.86, aliases: ["newcastle united", "nufc"] },
  { name: "Aston Villa", fullName: "Aston Villa FC", leagues: ["premier", "ucl"], elo: 1848, atk: 1.20, def: 0.89, aliases: ["villa", "avfc"] },
  { name: "Brighton", fullName: "Brighton & Hove Albion", leagues: ["premier"], elo: 1810, atk: 1.16, def: 0.94, aliases: ["brighton hove"] },
  { name: "Bournemouth", fullName: "AFC Bournemouth", leagues: ["premier"], elo: 1798, atk: 1.14, def: 0.94, aliases: ["afc bournemouth"] },
  { name: "Nottingham Forest", fullName: "Nottingham Forest", leagues: ["premier"], elo: 1790, atk: 1.09, def: 0.90, aliases: ["forest", "nffc"] },
  { name: "Tottenham", fullName: "Tottenham Hotspur", leagues: ["premier", "ucl"], elo: 1805, atk: 1.25, def: 0.98, aliases: ["spurs", "thfc", "tottenham hotspur"] },
  { name: "Manchester United", fullName: "Manchester United FC", leagues: ["premier"], elo: 1785, atk: 1.10, def: 0.96, aliases: ["man united", "man utd", "united", "mufc"] },
  { name: "Brentford", fullName: "Brentford FC", leagues: ["premier"], elo: 1775, atk: 1.14, def: 0.99, aliases: ["brentford fc"] },
  { name: "Fulham", fullName: "Fulham FC", leagues: ["premier"], elo: 1772, atk: 1.08, def: 0.96, aliases: ["fulham fc"] },
  { name: "Crystal Palace", fullName: "Crystal Palace FC", leagues: ["premier"], elo: 1768, atk: 1.06, def: 0.95, aliases: ["palace", "cpfc"] },
  { name: "West Ham", fullName: "West Ham United", leagues: ["premier"], elo: 1742, atk: 1.05, def: 1.05, aliases: ["west ham united", "whufc"] },
  { name: "Everton", fullName: "Everton FC", leagues: ["premier"], elo: 1735, atk: 0.94, def: 0.97, aliases: ["everton fc", "efc"] },
  { name: "Wolves", fullName: "Wolverhampton Wanderers", leagues: ["premier"], elo: 1712, atk: 0.99, def: 1.09, aliases: ["wolverhampton"] },
  { name: "Leeds", fullName: "Leeds United", leagues: ["premier"], elo: 1710, atk: 1.01, def: 1.07, aliases: ["leeds united", "lufc"] },
  { name: "Burnley", fullName: "Burnley FC", leagues: ["premier"], elo: 1690, atk: 0.90, def: 1.06, aliases: ["burnley fc"] },
  { name: "Sunderland", fullName: "Sunderland AFC", leagues: ["premier"], elo: 1668, atk: 0.91, def: 1.13, aliases: ["safc"] },

  // ================= LA LIGA =================
  { name: "Real Madrid", fullName: "Real Madrid CF", leagues: ["liga", "ucl"], elo: 1988, atk: 1.46, def: 0.74, aliases: ["real", "madrid", "rmcf"] },
  { name: "FC Barcelone", fullName: "FC Barcelona", leagues: ["liga", "ucl"], elo: 1980, atk: 1.52, def: 0.79, aliases: ["barcelone", "barca", "barça", "barcelona", "fcb"] },
  { name: "Atlético Madrid", fullName: "Atlético de Madrid", leagues: ["liga", "ucl"], elo: 1905, atk: 1.25, def: 0.73, aliases: ["atletico", "atletico madrid", "atleti"] },
  { name: "Athletic Bilbao", fullName: "Athletic Club Bilbao", leagues: ["liga", "ucl"], elo: 1842, atk: 1.15, def: 0.80, aliases: ["bilbao", "athletic club"] },
  { name: "Villarreal", fullName: "Villarreal CF", leagues: ["liga", "ucl"], elo: 1820, atk: 1.22, def: 0.92, aliases: ["villarreal cf"] },
  { name: "Real Betis", fullName: "Real Betis Balompié", leagues: ["liga"], elo: 1785, atk: 1.10, def: 0.91, aliases: ["betis"] },
  { name: "Real Sociedad", fullName: "Real Sociedad", leagues: ["liga"], elo: 1780, atk: 1.04, def: 0.86, aliases: ["sociedad", "la real"] },
  { name: "Celta Vigo", fullName: "RC Celta de Vigo", leagues: ["liga"], elo: 1742, atk: 1.11, def: 1.01, aliases: ["celta"] },
  { name: "Girona", fullName: "Girona FC", leagues: ["liga"], elo: 1745, atk: 1.09, def: 0.99, aliases: ["girone", "girona fc"] },
  { name: "Osasuna", fullName: "CA Osasuna", leagues: ["liga"], elo: 1735, atk: 1.01, def: 0.97, aliases: ["ca osasuna"] },
  { name: "Majorque", fullName: "RCD Mallorca", leagues: ["liga"], elo: 1728, atk: 0.94, def: 0.93, aliases: ["mallorca"] },
  { name: "Rayo Vallecano", fullName: "Rayo Vallecano", leagues: ["liga"], elo: 1725, atk: 0.97, def: 0.96, aliases: ["rayo"] },
  { name: "Séville", fullName: "Sevilla FC", leagues: ["liga"], elo: 1722, atk: 1.00, def: 1.01, aliases: ["sevilla", "seville"] },
  { name: "Valence", fullName: "Valencia CF", leagues: ["liga"], elo: 1708, atk: 0.95, def: 1.01, aliases: ["valencia"] },
  { name: "Getafe", fullName: "Getafe CF", leagues: ["liga"], elo: 1705, atk: 0.86, def: 0.92, aliases: ["getafe cf"] },
  { name: "Espanyol", fullName: "RCD Espanyol", leagues: ["liga"], elo: 1680, atk: 0.91, def: 1.07, aliases: ["rcd espanyol"] },
  { name: "Alavés", fullName: "Deportivo Alavés", leagues: ["liga"], elo: 1678, atk: 0.89, def: 1.05, aliases: ["alaves"] },

  // ================= BUNDESLIGA =================
  { name: "Bayern Munich", fullName: "FC Bayern München", leagues: ["bundesliga", "ucl"], elo: 1978, atk: 1.56, def: 0.76, aliases: ["bayern", "fc bayern", "munich"] },
  { name: "Bayer Leverkusen", fullName: "Bayer 04 Leverkusen", leagues: ["bundesliga", "ucl"], elo: 1925, atk: 1.38, def: 0.80, aliases: ["leverkusen", "bayer"] },
  { name: "Borussia Dortmund", fullName: "Borussia Dortmund", leagues: ["bundesliga", "ucl"], elo: 1865, atk: 1.32, def: 0.89, aliases: ["dortmund", "bvb"] },
  { name: "RB Leipzig", fullName: "RB Leipzig", leagues: ["bundesliga", "ucl"], elo: 1850, atk: 1.26, def: 0.87, aliases: ["leipzig", "rbl"] },
  { name: "Eintracht Francfort", fullName: "Eintracht Frankfurt", leagues: ["bundesliga", "ucl"], elo: 1825, atk: 1.25, def: 0.93, aliases: ["francfort", "frankfurt", "sge"] },
  { name: "Stuttgart", fullName: "VfB Stuttgart", leagues: ["bundesliga"], elo: 1815, atk: 1.24, def: 0.94, aliases: ["vfb stuttgart", "vfb"] },
  { name: "Fribourg", fullName: "SC Freiburg", leagues: ["bundesliga"], elo: 1775, atk: 1.08, def: 0.95, aliases: ["freiburg", "sc freiburg"] },
  { name: "Mayence", fullName: "1. FSV Mainz 05", leagues: ["bundesliga"], elo: 1765, atk: 1.09, def: 0.94, aliases: ["mainz", "mainz 05"] },
  { name: "Wolfsburg", fullName: "VfL Wolfsburg", leagues: ["bundesliga"], elo: 1742, atk: 1.08, def: 1.01, aliases: ["vfl wolfsburg"] },
  { name: "Mönchengladbach", fullName: "Borussia Mönchengladbach", leagues: ["bundesliga"], elo: 1735, atk: 1.09, def: 1.05, aliases: ["gladbach", "monchengladbach", "bmg"] },
  { name: "Werder Brême", fullName: "SV Werder Bremen", leagues: ["bundesliga"], elo: 1732, atk: 1.07, def: 1.04, aliases: ["werder", "bremen"] },
  { name: "Augsbourg", fullName: "FC Augsburg", leagues: ["bundesliga"], elo: 1705, atk: 0.96, def: 1.05, aliases: ["augsburg"] },
  { name: "Union Berlin", fullName: "1. FC Union Berlin", leagues: ["bundesliga"], elo: 1702, atk: 0.89, def: 0.99, aliases: ["union"] },
  { name: "Hoffenheim", fullName: "TSG Hoffenheim", leagues: ["bundesliga"], elo: 1695, atk: 1.04, def: 1.12, aliases: ["tsg hoffenheim"] },
  { name: "Cologne", fullName: "1. FC Köln", leagues: ["bundesliga"], elo: 1685, atk: 0.96, def: 1.08, aliases: ["koln", "köln"] },
  { name: "Hambourg", fullName: "Hamburger SV", leagues: ["bundesliga"], elo: 1680, atk: 0.99, def: 1.09, aliases: ["hsv", "hamburg"] },

  // ================= SERIE A =================
  { name: "Inter Milan", fullName: "FC Internazionale Milano", leagues: ["seriea", "ucl"], elo: 1962, atk: 1.42, def: 0.71, aliases: ["inter", "internazionale"] },
  { name: "Naples", fullName: "SSC Napoli", leagues: ["seriea", "ucl"], elo: 1902, atk: 1.26, def: 0.75, aliases: ["napoli", "ssc napoli"] },
  { name: "Atalanta", fullName: "Atalanta BC", leagues: ["seriea", "ucl"], elo: 1895, atk: 1.39, def: 0.82, aliases: ["atalanta bc", "bergamo"] },
  { name: "Juventus", fullName: "Juventus FC", leagues: ["seriea", "ucl"], elo: 1868, atk: 1.16, def: 0.75, aliases: ["juve", "juventus fc"] },
  { name: "AC Milan", fullName: "AC Milan", leagues: ["seriea"], elo: 1852, atk: 1.24, def: 0.86, aliases: ["milan", "rossoneri"] },
  { name: "AS Rome", fullName: "AS Roma", leagues: ["seriea"], elo: 1835, atk: 1.16, def: 0.84, aliases: ["roma", "as roma", "rome"] },
  { name: "Lazio", fullName: "SS Lazio", leagues: ["seriea"], elo: 1828, atk: 1.20, def: 0.89, aliases: ["ss lazio"] },
  { name: "Fiorentina", fullName: "ACF Fiorentina", leagues: ["seriea"], elo: 1812, atk: 1.15, def: 0.89, aliases: ["viola"] },
  { name: "Bologne", fullName: "Bologna FC", leagues: ["seriea"], elo: 1810, atk: 1.12, def: 0.86, aliases: ["bologna"] },
  { name: "Torino", fullName: "Torino FC", leagues: ["seriea"], elo: 1742, atk: 0.95, def: 0.94, aliases: ["torino fc"] },
  { name: "Côme", fullName: "Como 1907", leagues: ["seriea"], elo: 1735, atk: 1.04, def: 0.99, aliases: ["como"] },
  { name: "Udinese", fullName: "Udinese Calcio", leagues: ["seriea"], elo: 1718, atk: 0.96, def: 1.01, aliases: ["udinese calcio"] },
  { name: "Genoa", fullName: "Genoa CFC", leagues: ["seriea"], elo: 1708, atk: 0.92, def: 1.00, aliases: ["genoa cfc"] },
  { name: "Parme", fullName: "Parma Calcio", leagues: ["seriea"], elo: 1682, atk: 0.95, def: 1.10, aliases: ["parma"] },
  { name: "Cagliari", fullName: "Cagliari Calcio", leagues: ["seriea"], elo: 1678, atk: 0.92, def: 1.09, aliases: ["cagliari calcio"] },

  // ================= AUTRES GÉANTS CHAMPIONS LEAGUE =================
  { name: "Sporting CP", fullName: "Sporting Clube de Portugal", leagues: ["ucl"], elo: 1865, atk: 1.32, def: 0.82, aliases: ["sporting", "sporting lisbonne"] },
  { name: "Benfica", fullName: "SL Benfica", leagues: ["ucl"], elo: 1852, atk: 1.28, def: 0.84, aliases: ["sl benfica"] },
  { name: "FC Porto", fullName: "FC Porto", leagues: ["ucl"], elo: 1825, atk: 1.20, def: 0.86, aliases: ["porto"] },
  { name: "PSV Eindhoven", fullName: "PSV Eindhoven", leagues: ["ucl"], elo: 1835, atk: 1.33, def: 0.89, aliases: ["psv"] },
  { name: "Ajax", fullName: "AFC Ajax", leagues: ["ucl"], elo: 1790, atk: 1.18, def: 0.94, aliases: ["ajax amsterdam"] },
  { name: "Feyenoord", fullName: "Feyenoord Rotterdam", leagues: ["ucl"], elo: 1805, atk: 1.21, def: 0.91, aliases: ["feyenoord rotterdam"] },
  { name: "Club Bruges", fullName: "Club Brugge KV", leagues: ["ucl"], elo: 1775, atk: 1.14, def: 0.93, aliases: ["club brugge", "bruges"] },
  { name: "Galatasaray", fullName: "Galatasaray SK", leagues: ["ucl"], elo: 1785, atk: 1.22, def: 0.96, aliases: ["gala"] },

  // ================= SÉLECTIONS INTERNATIONALES (CAN / MONDIAL / EURO) =================
  { name: "Espagne", fullName: "Espagne", leagues: ["international"], elo: 2010, atk: 1.45, def: 0.69, aliases: ["spain", "la roja"] },
  { name: "Argentine", fullName: "Argentine", leagues: ["international"], elo: 2005, atk: 1.40, def: 0.68, aliases: ["argentina"] },
  { name: "France", fullName: "Équipe de France", leagues: ["international"], elo: 1985, atk: 1.36, def: 0.71, aliases: ["les bleus", "edf"] },
  { name: "Angleterre", fullName: "Angleterre", leagues: ["international"], elo: 1955, atk: 1.30, def: 0.74, aliases: ["england"] },
  { name: "Brésil", fullName: "Brésil", leagues: ["international"], elo: 1935, atk: 1.31, def: 0.79, aliases: ["brazil", "selecao"] },
  { name: "Portugal", fullName: "Portugal", leagues: ["international"], elo: 1940, atk: 1.34, def: 0.76, aliases: ["seleccao"] },
  { name: "Allemagne", fullName: "Allemagne", leagues: ["international"], elo: 1930, atk: 1.35, def: 0.80, aliases: ["germany", "mannschaft"] },
  { name: "Maroc", fullName: "Maroc (Lions de l'Atlas)", leagues: ["international"], elo: 1865, atk: 1.18, def: 0.74, aliases: ["morocco", "lions de l'atlas"] },
  { name: "Côte d'Ivoire", fullName: "Côte d'Ivoire (Les Éléphants)", leagues: ["international"], elo: 1835, atk: 1.18, def: 0.82, aliases: ["cote d'ivoire", "cote divoire", "civ", "elephants", "éléphants"] },
  { name: "Sénégal", fullName: "Sénégal (Lions de la Teranga)", leagues: ["international"], elo: 1848, atk: 1.16, def: 0.78, aliases: ["senegal"] },
  { name: "Nigeria", fullName: "Nigeria (Super Eagles)", leagues: ["international"], elo: 1815, atk: 1.16, def: 0.86, aliases: ["super eagles"] },
  { name: "Égypte", fullName: "Égypte", leagues: ["international"], elo: 1795, atk: 1.09, def: 0.85, aliases: ["egypte", "egypt"] },
  { name: "Algérie", fullName: "Algérie", leagues: ["international"], elo: 1792, atk: 1.14, def: 0.88, aliases: ["algerie", "fennecs"] },
  { name: "Cameroun", fullName: "Cameroun", leagues: ["international"], elo: 1775, atk: 1.08, def: 0.90, aliases: ["lions indomptables"] },
  { name: "Mali", fullName: "Mali", leagues: ["international"], elo: 1770, atk: 1.05, def: 0.88, aliases: ["aigles du mali"] },
  { name: "RD Congo", fullName: "RD Congo", leagues: ["international"], elo: 1765, atk: 1.06, def: 0.90, aliases: ["rdc", "congo", "leopards"] },
];

export function normalizeKey(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ");
}

// Indexation O(1) construite une seule fois au chargement du module
const CLUB_LOOKUP = new Map();
for (const club of CLUBS_DB) {
  CLUB_LOOKUP.set(normalizeKey(club.name), club);
  CLUB_LOOKUP.set(normalizeKey(club.fullName), club);
  for (const alias of club.aliases || []) {
    CLUB_LOOKUP.set(normalizeKey(alias), club);
  }
}

export function resolveClub(rawName) {
  const key = normalizeKey(rawName);
  if (!key) return null;
  if (CLUB_LOOKUP.has(key)) return CLUB_LOOKUP.get(key);
  // Recherche préfixe partielle si >= 4 caractères
  if (key.length >= 4) {
    for (const club of CLUBS_DB) {
      if (normalizeKey(club.name).startsWith(key) || normalizeKey(club.fullName).includes(key)) {
        return club;
      }
    }
  }
  return null;
}

export function canonicalTeamName(rawName) {
  const found = resolveClub(rawName);
  return found ? found.name : String(rawName || "").trim();
}

export function getClubsForLeague(leagueId) {
  return CLUBS_DB.filter((c) => c.leagues.includes(leagueId)).sort((a, b) => b.elo - a.elo);
}

// Jeu de calibration réaliste (24 matchs multi-championnats) pour pré-entraîner et tester l'IA en 1 clic
export const CALIBRATION_MATCHES = [
  { league: "ligue1", home: "PSG", away: "Marseille", scoreHome: 3, scoreAway: 1, date: "08/09/2026" },
  { league: "ligue1", home: "Monaco", away: "Lille", scoreHome: 1, scoreAway: 1, date: "12/09/2026" },
  { league: "ligue1", home: "Lyon", away: "Strasbourg", scoreHome: 2, scoreAway: 1, date: "15/09/2026" },
  { league: "ligue1", home: "Le Havre", away: "PSG", scoreHome: 0, scoreAway: 3, date: "19/09/2026" },
  { league: "ligue1", home: "Lens", away: "Nice", scoreHome: 1, scoreAway: 1, date: "22/09/2026" },
  { league: "premier", home: "Liverpool", away: "Chelsea", scoreHome: 2, scoreAway: 1, date: "10/09/2026" },
  { league: "premier", home: "Arsenal", away: "Tottenham", scoreHome: 2, scoreAway: 0, date: "14/09/2026" },
  { league: "premier", home: "Manchester City", away: "Brentford", scoreHome: 3, scoreAway: 1, date: "18/09/2026" },
  { league: "premier", home: "Brighton", away: "Newcastle", scoreHome: 1, scoreAway: 1, date: "21/09/2026" },
  { league: "premier", home: "Sunderland", away: "Arsenal", scoreHome: 0, scoreAway: 2, date: "26/09/2026" },
  { league: "liga", home: "Real Madrid", away: "Villarreal", scoreHome: 2, scoreAway: 0, date: "11/09/2026" },
  { league: "liga", home: "FC Barcelone", away: "Séville", scoreHome: 4, scoreAway: 1, date: "16/09/2026" },
  { league: "liga", home: "Atlético Madrid", away: "Real Sociedad", scoreHome: 1, scoreAway: 0, date: "20/09/2026" },
  { league: "liga", home: "Getafe", away: "Osasuna", scoreHome: 0, scoreAway: 0, date: "25/09/2026" },
  { league: "bundesliga", home: "Bayern Munich", away: "Fribourg", scoreHome: 3, scoreAway: 0, date: "13/09/2026" },
  { league: "bundesliga", home: "Bayer Leverkusen", away: "Stuttgart", scoreHome: 2, scoreAway: 2, date: "17/09/2026" },
  { league: "bundesliga", home: "Hoffenheim", away: "Bayern Munich", scoreHome: 1, scoreAway: 4, date: "24/09/2026" },
  { league: "bundesliga", home: "Borussia Dortmund", away: "Werder Brême", scoreHome: 3, scoreAway: 1, date: "28/09/2026" },
  { league: "seriea", home: "Inter Milan", away: "Atalanta", scoreHome: 2, scoreAway: 0, date: "13/09/2026" },
  { league: "seriea", home: "Juventus", away: "Naples", scoreHome: 0, scoreAway: 0, date: "21/09/2026" },
  { league: "seriea", home: "Parme", away: "Inter Milan", scoreHome: 0, scoreAway: 2, date: "27/09/2026" },
  { league: "ucl", home: "Real Madrid", away: "Borussia Dortmund", scoreHome: 3, scoreAway: 1, date: "30/09/2026" },
  { league: "international", home: "Côte d'Ivoire", away: "Nigeria", scoreHome: 2, scoreAway: 1, date: "09/10/2026" },
  { league: "international", home: "Maroc", away: "Sénégal", scoreHome: 1, scoreAway: 1, date: "13/10/2026" },
];

// ============================================================================
// sync-squads — pulls squad + coach data for all WC 2026 teams from
// football-data.org and stores in public.teams + public.players.
//
// Rate limit: football-data.org free tier is 10 req/min. We have up to 32
// teams but the /competitions/WC/teams endpoint returns all at once (1 call),
// so we only need 1 API call total. Players come bundled in that response.
//
// Trigger manually from Admin. No pg_cron — squads change rarely.
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const API_KEY          = Deno.env.get('FOOTBALL_DATA_API_KEY')!
const BASE_URL         = 'https://api.football-data.org/v4'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

// ---------------------------------------------------------------------------
// football-data.org response shapes
// ---------------------------------------------------------------------------

type FDPlayer = {
  id: number
  name: string
  position: string | null
  shirtNumber: number | null
  dateOfBirth: string | null
  nationality: string | null
}

type FDCoach = {
  id?: number
  name: string | null
  nationality: string | null
}

type FDTeam = {
  id: number
  name: string
  shortName: string
  tla: string
  crest: string
  coach: FDCoach | null
  squad: FDPlayer[]
}

type FDTeamsResponse = {
  teams: FDTeam[]
}

// ---------------------------------------------------------------------------
// Slug utility (mirrors SupabaseAdapter.slugify)
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}/gu, '')   // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return new Response('Use POST', { status: 405, headers: CORS_HEADERS })

  if (!API_KEY) {
    return jsonResponse({ error: 'FOOTBALL_DATA_API_KEY secret not set. Run: npx supabase secrets set FOOTBALL_DATA_API_KEY=<key>' }, 503)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // One call fetches all teams + squads for the WC 2026 competition
  const res = await fetch(`${BASE_URL}/competitions/WC/teams?season=2026`, {
    headers: { 'X-Auth-Token': API_KEY },
  })

  if (!res.ok) {
    const text = await res.text()
    return jsonResponse({ error: `football-data.org error ${res.status}: ${text.slice(0, 300)}` }, 502)
  }

  const data: FDTeamsResponse = await res.json()
  const teams = data.teams ?? []

  let teamsUpserted = 0
  let playersUpserted = 0
  const errors: string[] = []

  for (const t of teams) {
    const teamId = slugify(t.name)

    // Upsert team row
    const { error: tErr } = await supabase.from('teams').upsert({
      id:                 teamId,
      name:               t.name,
      short_name:         t.shortName ?? null,
      tla:                t.tla ?? null,
      coach_name:         t.coach?.name ?? null,
      coach_nationality:  t.coach?.nationality ?? null,
      crest_url:          t.crest ?? null,
      fd_id:              t.id,
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'id' })

    if (tErr) { errors.push(`team ${t.name}: ${tErr.message}`); continue }
    teamsUpserted++

    // Upsert players for this team
    if (!t.squad || t.squad.length === 0) continue

    const playerRows = t.squad.map((p) => ({
      team_id:       teamId,
      fd_id:         p.id,
      name:          p.name,
      position:      p.position ?? null,
      shirt_number:  p.shirtNumber ?? null,
      date_of_birth: p.dateOfBirth ?? null,
      nationality:   p.nationality ?? null,
      updated_at:    new Date().toISOString(),
    }))

    const { error: pErr } = await supabase
      .from('players')
      .upsert(playerRows, { onConflict: 'team_id,fd_id' })

    if (pErr) { errors.push(`players for ${t.name}: ${pErr.message}`); continue }
    playersUpserted += playerRows.length
  }

  return jsonResponse({
    teams:     teamsUpserted,
    players:   playersUpserted,
    errors:    errors.length > 0 ? errors : undefined,
  })
})

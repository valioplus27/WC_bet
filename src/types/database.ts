// Hand-written to mirror supabase/migrations/*.sql.
//
// Once the project is linked to Supabase, you can replace this file with a
// generated one that's guaranteed to match the live schema:
//
//   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
//
// Shaped to satisfy @supabase/supabase-js's GenericSchema/GenericTable
// constraints exactly the way `gen types` output does (Relationships on every
// table; Views/Functions/Enums/CompositeTypes on the schema) — omitting them
// makes the client fall back to `never` for every row/insert/update type.

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          display_name: string
          is_admin: boolean
          has_password: boolean
          created_at: string
        }
        Insert: {
          id: string
          display_name: string
          is_admin?: boolean
          has_password?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          display_name?: string
          is_admin?: boolean
          has_password?: boolean
          created_at?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          id: number
          ext_id: string
          home_team: string
          away_team: string
          kickoff_at: string
          stage: string
          group_name: string | null
          home_score: number | null
          away_score: number | null
          status: string
          updated_at: string
        }
        Insert: {
          id?: number
          ext_id: string
          home_team: string
          away_team: string
          kickoff_at: string
          stage: string
          group_name?: string | null
          home_score?: number | null
          away_score?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          id?: number
          ext_id?: string
          home_team?: string
          away_team?: string
          kickoff_at?: string
          stage?: string
          group_name?: string | null
          home_score?: number | null
          away_score?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      standings: {
        Row: {
          id: number
          group_name: string
          team_name: string
          played: number
          won: number
          draw: number
          lost: number
          goals_for: number
          goals_against: number
          goal_difference: number
          points: number
          position: number | null
          updated_at: string
        }
        Insert: {
          id?: number
          group_name: string
          team_name: string
          played?: number
          won?: number
          draw?: number
          lost?: number
          goals_for?: number
          goals_against?: number
          goal_difference?: number
          points?: number
          position?: number | null
          updated_at?: string
        }
        Update: {
          id?: number
          group_name?: string
          team_name?: string
          played?: number
          won?: number
          draw?: number
          lost?: number
          goals_for?: number
          goals_against?: number
          goal_difference?: number
          points?: number
          position?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      bets: {
        Row: {
          id: number
          user_id: string
          match_id: number
          predicted_home: number
          predicted_away: number
          points_awarded: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          user_id: string
          match_id: number
          predicted_home: number
          predicted_away: number
          points_awarded?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          match_id?: number
          predicted_home?: number
          predicted_away?: number
          points_awarded?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tournament_bets: {
        Row: {
          id: number
          user_id: string
          pick_first: string
          pick_second: string
          pick_third: string
          pick_top_scorer: string
          points_awarded: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: number
          user_id: string
          pick_first: string
          pick_second: string
          pick_third: string
          pick_top_scorer: string
          points_awarded?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: number
          user_id?: string
          pick_first?: string
          pick_second?: string
          pick_third?: string
          pick_top_scorer?: string
          points_awarded?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      tournament_config: {
        Row: {
          id: number
          lock_at: string
          actual_first: string | null
          actual_second: string | null
          actual_third: string | null
          actual_top_scorer: string | null
          points_podium_correct_position: number
          points_top_scorer: number
          updated_at: string
        }
        Insert: {
          id?: number
          lock_at: string
          actual_first?: string | null
          actual_second?: string | null
          actual_third?: string | null
          actual_top_scorer?: string | null
          points_podium_correct_position?: number
          points_top_scorer?: number
          updated_at?: string
        }
        Update: {
          id?: number
          lock_at?: string
          actual_first?: string | null
          actual_second?: string | null
          actual_third?: string | null
          actual_top_scorer?: string | null
          points_podium_correct_position?: number
          points_top_scorer?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

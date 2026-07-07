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
          apifootball_id: number | null
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
          apifootball_id?: number | null
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
          apifootball_id?: number | null
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
      scorers: {
        Row: {
          id: number
          player_ext_id: number
          player_name: string
          team_name: string
          nationality: string | null
          goals: number
          assists: number
          penalties: number
          played_matches: number
          updated_at: string
        }
        Insert: {
          id?: number
          player_ext_id: number
          player_name: string
          team_name: string
          nationality?: string | null
          goals?: number
          assists?: number
          penalties?: number
          played_matches?: number
          updated_at?: string
        }
        Update: {
          id?: number
          player_ext_id?: number
          player_name?: string
          team_name?: string
          nationality?: string | null
          goals?: number
          assists?: number
          penalties?: number
          played_matches?: number
          updated_at?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          user_id: string
          match_id: number
          emoji: string
          created_at: string
        }
        Insert: {
          user_id: string
          match_id: number
          emoji: string
          created_at?: string
        }
        Update: {
          user_id?: string
          match_id?: number
          emoji?: string
          created_at?: string
        }
        Relationships: []
      }
      predictions: {
        Row: {
          id: number
          match_id: number
          model_version: string
          home_win_prob: number
          draw_prob: number
          away_win_prob: number
          actual_outcome: 'home_win' | 'draw' | 'away_win' | null
          brier_score: number | null
          log_loss: number | null
          computed_at: string
          resolved_at: string | null
        }
        Insert: {
          id?: number
          match_id: number
          model_version?: string
          home_win_prob: number
          draw_prob: number
          away_win_prob: number
          actual_outcome?: 'home_win' | 'draw' | 'away_win' | null
          brier_score?: number | null
          log_loss?: number | null
          computed_at?: string
          resolved_at?: string | null
        }
        Update: {
          id?: number
          match_id?: number
          model_version?: string
          home_win_prob?: number
          draw_prob?: number
          away_win_prob?: number
          actual_outcome?: 'home_win' | 'draw' | 'away_win' | null
          brier_score?: number | null
          log_loss?: number | null
          computed_at?: string
          resolved_at?: string | null
        }
        Relationships: []
      }
      shots: {
        Row: {
          id: number
          source: string
          match_ext_id: string
          competition_id: number | null
          season_id: number | null
          minute: number
          period: number
          team: string
          player: string
          x: number
          y: number
          xg: number | null
          outcome: string
          body_part: string | null
          is_penalty: boolean
          created_at: string
        }
        Insert: {
          id?: number
          source: string
          match_ext_id: string
          competition_id?: number | null
          season_id?: number | null
          minute: number
          period?: number
          team: string
          player: string
          x: number
          y: number
          xg?: number | null
          outcome: string
          body_part?: string | null
          is_penalty?: boolean
          created_at?: string
        }
        Update: {
          id?: number
          source?: string
          match_ext_id?: string
          competition_id?: number | null
          season_id?: number | null
          minute?: number
          period?: number
          team?: string
          player?: string
          x?: number
          y?: number
          xg?: number | null
          outcome?: string
          body_part?: string | null
          is_penalty?: boolean
          created_at?: string
        }
        Relationships: []
      }
      match_events_live: {
        Row: {
          id: number
          match_id: number
          minute: number
          extra_minute: number | null
          event_type: string
          team: string
          player: string | null
          assist: string | null
          detail: string | null
          created_at: string
        }
        Insert: {
          id?: number
          match_id: number
          minute: number
          extra_minute?: number | null
          event_type: string
          team: string
          player?: string | null
          assist?: string | null
          detail?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          match_id?: number
          minute?: number
          extra_minute?: number | null
          event_type?: string
          team?: string
          player?: string | null
          assist?: string | null
          detail?: string | null
          created_at?: string
        }
        Relationships: []
      }
      match_stats: {
        Row: {
          match_id: number
          home_possession: number | null
          away_possession: number | null
          home_shots: number | null
          away_shots: number | null
          home_shots_on_target: number | null
          away_shots_on_target: number | null
          home_corners: number | null
          away_corners: number | null
          home_fouls: number | null
          away_fouls: number | null
          home_yellow_cards: number | null
          away_yellow_cards: number | null
          home_red_cards: number | null
          away_red_cards: number | null
          home_offsides: number | null
          away_offsides: number | null
          updated_at: string
        }
        Insert: {
          match_id: number
          home_possession?: number | null
          away_possession?: number | null
          home_shots?: number | null
          away_shots?: number | null
          home_shots_on_target?: number | null
          away_shots_on_target?: number | null
          home_corners?: number | null
          away_corners?: number | null
          home_fouls?: number | null
          away_fouls?: number | null
          home_yellow_cards?: number | null
          away_yellow_cards?: number | null
          home_red_cards?: number | null
          away_red_cards?: number | null
          home_offsides?: number | null
          away_offsides?: number | null
          updated_at?: string
        }
        Update: {
          match_id?: number
          home_possession?: number | null
          away_possession?: number | null
          home_shots?: number | null
          away_shots?: number | null
          home_shots_on_target?: number | null
          away_shots_on_target?: number | null
          home_corners?: number | null
          away_corners?: number | null
          home_fouls?: number | null
          away_fouls?: number | null
          home_yellow_cards?: number | null
          away_yellow_cards?: number | null
          home_red_cards?: number | null
          away_red_cards?: number | null
          home_offsides?: number | null
          away_offsides?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      match_events: {
        Row: {
          id: number
          source: string
          match_ext_id: string
          competition_id: number | null
          season_id: number | null
          event_type: string
          minute: number
          period: number
          team: string
          player: string | null
          to_player: string | null
          x: number | null
          y: number | null
          end_x: number | null
          end_y: number | null
          outcome: string | null
          created_at: string
        }
        Insert: {
          id?: number
          source: string
          match_ext_id: string
          competition_id?: number | null
          season_id?: number | null
          event_type: string
          minute: number
          period?: number
          team: string
          player?: string | null
          to_player?: string | null
          x?: number | null
          y?: number | null
          end_x?: number | null
          end_y?: number | null
          outcome?: string | null
          created_at?: string
        }
        Update: {
          id?: number
          source?: string
          match_ext_id?: string
          competition_id?: number | null
          season_id?: number | null
          event_type?: string
          minute?: number
          period?: number
          team?: string
          player?: string | null
          to_player?: string | null
          x?: number | null
          y?: number | null
          end_x?: number | null
          end_y?: number | null
          outcome?: string | null
          created_at?: string
        }
        Relationships: []
      }
      teams: {
        Row: {
          id: string
          name: string
          short_name: string | null
          tla: string | null
          coach_name: string | null
          coach_nationality: string | null
          crest_url: string | null
          fd_id: number | null
          updated_at: string
        }
        Insert: {
          id: string
          name: string
          short_name?: string | null
          tla?: string | null
          coach_name?: string | null
          coach_nationality?: string | null
          crest_url?: string | null
          fd_id?: number | null
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          short_name?: string | null
          tla?: string | null
          coach_name?: string | null
          coach_nationality?: string | null
          crest_url?: string | null
          fd_id?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      players: {
        Row: {
          id: number
          team_id: string
          fd_id: number | null
          name: string
          position: string | null
          shirt_number: number | null
          date_of_birth: string | null
          nationality: string | null
          updated_at: string
        }
        Insert: {
          id?: number
          team_id: string
          fd_id?: number | null
          name: string
          position?: string | null
          shirt_number?: number | null
          date_of_birth?: string | null
          nationality?: string | null
          updated_at?: string
        }
        Update: {
          id?: number
          team_id?: string
          fd_id?: number | null
          name?: string
          position?: string | null
          shirt_number?: number | null
          date_of_birth?: string | null
          nationality?: string | null
          updated_at?: string
        }
        Relationships: [
          { foreignKeyName: 'players_team_id_fkey'; columns: ['team_id']; referencedRelation: 'teams'; referencedColumns: ['id'] }
        ]
      }
      team_analytics: {
        Row: {
          team_name: string
          source: string
          avg_passes_per_match: number | null
          pass_completion_rate: number | null
          avg_progressive_passes: number | null
          avg_pressures_per_match: number | null
          press_success_rate: number | null
          avg_carries_per_match: number | null
          avg_shots_per_match: number | null
          avg_xg_per_match: number | null
          avg_xg_per_shot: number | null
          avg_tackles_per_match: number | null
          avg_interceptions_per_match: number | null
          network_centralization: number | null
          avg_chain_length: number | null
          chaos_index: number | null
          matches_in_sample: number
          updated_at: string
        }
        Insert: {
          team_name: string
          source?: string
          avg_passes_per_match?: number | null
          pass_completion_rate?: number | null
          avg_progressive_passes?: number | null
          avg_pressures_per_match?: number | null
          press_success_rate?: number | null
          avg_carries_per_match?: number | null
          avg_shots_per_match?: number | null
          avg_xg_per_match?: number | null
          avg_xg_per_shot?: number | null
          avg_tackles_per_match?: number | null
          avg_interceptions_per_match?: number | null
          network_centralization?: number | null
          avg_chain_length?: number | null
          chaos_index?: number | null
          matches_in_sample?: number
          updated_at?: string
        }
        Update: {
          team_name?: string
          source?: string
          avg_passes_per_match?: number | null
          pass_completion_rate?: number | null
          avg_progressive_passes?: number | null
          avg_pressures_per_match?: number | null
          press_success_rate?: number | null
          avg_carries_per_match?: number | null
          avg_shots_per_match?: number | null
          avg_xg_per_match?: number | null
          avg_xg_per_shot?: number | null
          avg_tackles_per_match?: number | null
          avg_interceptions_per_match?: number | null
          network_centralization?: number | null
          avg_chain_length?: number | null
          chaos_index?: number | null
          matches_in_sample?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      // Lets the sign-in screen ask "does this email already have an account?"
      // before sending a magic link — see the email_has_account_lookup migration.
      email_has_account: {
        Args: { lookup_email: string }
        Returns: boolean
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

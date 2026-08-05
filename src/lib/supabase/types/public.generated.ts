export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          metadata: Json
          resource_id: string | null
          resource_type: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          resource_id?: string | null
          resource_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_persona: {
        Row: {
          brand_id: string
          id: string
          mission: string | null
          tenant_id: string
          tone: string
          updated_at: string
          values_json: Json
        }
        Insert: {
          brand_id: string
          id?: string
          mission?: string | null
          tenant_id: string
          tone: string
          updated_at?: string
          values_json?: Json
        }
        Update: {
          brand_id?: string
          id?: string
          mission?: string | null
          tenant_id?: string
          tone?: string
          updated_at?: string
          values_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "brand_persona_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_persona_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      brands: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          tenant_id: string
          website_url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          tenant_id: string
          website_url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          tenant_id?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brands_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_session_state: {
        Row: {
          brand_id: string
          consecutive_clarify_count: number
          created_at: string
          customer_id: string | null
          id: string
          last_intent: string | null
          last_sub_intent: string | null
          name_asked: boolean
          name_captured: boolean
          phone_asked: boolean
          preferred_language: string | null
          preferred_language_source: string | null
          session_id: string
          tenant_id: string
          turn_count: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          consecutive_clarify_count?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          last_intent?: string | null
          last_sub_intent?: string | null
          name_asked?: boolean
          name_captured?: boolean
          phone_asked?: boolean
          preferred_language?: string | null
          preferred_language_source?: string | null
          session_id: string
          tenant_id: string
          turn_count?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          consecutive_clarify_count?: number
          created_at?: string
          customer_id?: string | null
          id?: string
          last_intent?: string | null
          last_sub_intent?: string | null
          name_asked?: boolean
          name_captured?: boolean
          phone_asked?: boolean
          preferred_language?: string | null
          preferred_language_source?: string | null
          session_id?: string
          tenant_id?: string
          turn_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_session_state_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_session_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_turns: {
        Row: {
          assistant_message: string
          brand_id: string
          channel: string
          contact_captured: boolean
          conversation_history_length: number
          created_at: string
          id: string
          language_actually_generated: string | null
          language_detected: string | null
          latency_ms: number | null
          model_used: string
          retrieved_context_ids: string[]
          session_id: string
          short_circuit_hit: string | null
          tenant_id: string
          tokens_in: number
          tokens_out: number
          turn_index: number
          user_message: string
        }
        Insert: {
          assistant_message: string
          brand_id: string
          channel: string
          contact_captured?: boolean
          conversation_history_length?: number
          created_at?: string
          id?: string
          language_actually_generated?: string | null
          language_detected?: string | null
          latency_ms?: number | null
          model_used: string
          retrieved_context_ids?: string[]
          session_id: string
          short_circuit_hit?: string | null
          tenant_id: string
          tokens_in?: number
          tokens_out?: number
          turn_index: number
          user_message: string
        }
        Update: {
          assistant_message?: string
          brand_id?: string
          channel?: string
          contact_captured?: boolean
          conversation_history_length?: number
          created_at?: string
          id?: string
          language_actually_generated?: string | null
          language_detected?: string | null
          latency_ms?: number | null
          model_used?: string
          retrieved_context_ids?: string[]
          session_id?: string
          short_circuit_hit?: string | null
          tenant_id?: string
          tokens_in?: number
          tokens_out?: number
          turn_index?: number
          user_message?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_turns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_turns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      commerce_connections: {
        Row: {
          brand_id: string
          connected_by: string | null
          created_at: string
          credentials_encrypted: string
          id: string
          last_error: string | null
          last_sync_at: string | null
          last_sync_result: Json | null
          platform: string
          status: string
          store_url: string
          tenant_id: string
          updated_at: string
          webhook_secret_encrypted: string | null
        }
        Insert: {
          brand_id: string
          connected_by?: string | null
          created_at?: string
          credentials_encrypted: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_result?: Json | null
          platform: string
          status?: string
          store_url: string
          tenant_id: string
          updated_at?: string
          webhook_secret_encrypted?: string | null
        }
        Update: {
          brand_id?: string
          connected_by?: string | null
          created_at?: string
          credentials_encrypted?: string
          id?: string
          last_error?: string | null
          last_sync_at?: string | null
          last_sync_result?: Json | null
          platform?: string
          status?: string
          store_url?: string
          tenant_id?: string
          updated_at?: string
          webhook_secret_encrypted?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "commerce_connections_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commerce_connections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      content_outputs: {
        Row: {
          archived_at: string | null
          brand_id: string
          citations_tracked: Json
          content_markdown: string | null
          created_at: string
          id: string
          language: string
          last_citation_check_at: string | null
          meta: Json
          output_type: string
          parent_slug: string | null
          published_at: string | null
          schema_jsonld: Json | null
          slug: string
          source_chunk_ids: string[]
          source_memory_types: Database["public"]["Enums"]["memory_type"][]
          status: string
          tenant_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          brand_id: string
          citations_tracked?: Json
          content_markdown?: string | null
          created_at?: string
          id?: string
          language?: string
          last_citation_check_at?: string | null
          meta?: Json
          output_type: string
          parent_slug?: string | null
          published_at?: string | null
          schema_jsonld?: Json | null
          slug: string
          source_chunk_ids?: string[]
          source_memory_types?: Database["public"]["Enums"]["memory_type"][]
          status?: string
          tenant_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          brand_id?: string
          citations_tracked?: Json
          content_markdown?: string | null
          created_at?: string
          id?: string
          language?: string
          last_citation_check_at?: string | null
          meta?: Json
          output_type?: string
          parent_slug?: string | null
          published_at?: string | null
          schema_jsonld?: Json | null
          slug?: string
          source_chunk_ids?: string[]
          source_memory_types?: Database["public"]["Enums"]["memory_type"][]
          status?: string
          tenant_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_outputs_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_outputs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          bike_model: string | null
          brand_id: string
          created_at: string
          dormant_flag: boolean
          email: string | null
          email_hash: string | null
          full_name: string | null
          home_state: string | null
          id: string
          language_preference: string | null
          last_contact_at: string | null
          last_contact_channel: string | null
          last_contact_date: string | null
          last_intent: string | null
          last_sub_intent: string | null
          lead_score: number | null
          lifetime_value: number
          lifetime_value_inr: number | null
          metadata: Json
          next_contact_date: string | null
          notify_subscriptions: string[] | null
          phone: string | null
          phone_hash: string | null
          preferred_language: string | null
          preferred_language_source: string | null
          riding_style: string | null
          sentiment: string | null
          tenant_id: string
          total_orders: number
          total_sessions: number
          total_turns: number
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          bike_model?: string | null
          brand_id: string
          created_at?: string
          dormant_flag?: boolean
          email?: string | null
          email_hash?: string | null
          full_name?: string | null
          home_state?: string | null
          id?: string
          language_preference?: string | null
          last_contact_at?: string | null
          last_contact_channel?: string | null
          last_contact_date?: string | null
          last_intent?: string | null
          last_sub_intent?: string | null
          lead_score?: number | null
          lifetime_value?: number
          lifetime_value_inr?: number | null
          metadata?: Json
          next_contact_date?: string | null
          notify_subscriptions?: string[] | null
          phone?: string | null
          phone_hash?: string | null
          preferred_language?: string | null
          preferred_language_source?: string | null
          riding_style?: string | null
          sentiment?: string | null
          tenant_id: string
          total_orders?: number
          total_sessions?: number
          total_turns?: number
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          bike_model?: string | null
          brand_id?: string
          created_at?: string
          dormant_flag?: boolean
          email?: string | null
          email_hash?: string | null
          full_name?: string | null
          home_state?: string | null
          id?: string
          language_preference?: string | null
          last_contact_at?: string | null
          last_contact_channel?: string | null
          last_contact_date?: string | null
          last_intent?: string | null
          last_sub_intent?: string | null
          lead_score?: number | null
          lifetime_value?: number
          lifetime_value_inr?: number | null
          metadata?: Json
          next_contact_date?: string | null
          notify_subscriptions?: string[] | null
          phone?: string | null
          phone_hash?: string | null
          preferred_language?: string | null
          preferred_language_source?: string | null
          riding_style?: string | null
          sentiment?: string | null
          tenant_id?: string
          total_orders?: number
          total_sessions?: number
          total_turns?: number
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_cases: {
        Row: {
          allowed_styles: string[] | null
          brand_id: string | null
          case_type: string
          created_at: string
          expected_response_pattern: string | null
          fail_streak: number | null
          forbidden_patterns: string[] | null
          id: string
          last_run_at: string | null
          last_run_passed: boolean | null
          origin_kind: string
          origin_review_queue_id: string | null
          required_memory_type:
            | Database["public"]["Enums"]["memory_type"]
            | null
          required_source_id: string | null
          status: string
          tenant_id: string
          trigger_question: string
        }
        Insert: {
          allowed_styles?: string[] | null
          brand_id?: string | null
          case_type: string
          created_at?: string
          expected_response_pattern?: string | null
          fail_streak?: number | null
          forbidden_patterns?: string[] | null
          id?: string
          last_run_at?: string | null
          last_run_passed?: boolean | null
          origin_kind: string
          origin_review_queue_id?: string | null
          required_memory_type?:
            | Database["public"]["Enums"]["memory_type"]
            | null
          required_source_id?: string | null
          status?: string
          tenant_id: string
          trigger_question: string
        }
        Update: {
          allowed_styles?: string[] | null
          brand_id?: string | null
          case_type?: string
          created_at?: string
          expected_response_pattern?: string | null
          fail_streak?: number | null
          forbidden_patterns?: string[] | null
          id?: string
          last_run_at?: string | null
          last_run_passed?: boolean | null
          origin_kind?: string
          origin_review_queue_id?: string | null
          required_memory_type?:
            | Database["public"]["Enums"]["memory_type"]
            | null
          required_source_id?: string | null
          status?: string
          tenant_id?: string
          trigger_question?: string
        }
        Relationships: [
          {
            foreignKeyName: "evaluation_cases_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_cases_required_source_id_fkey"
            columns: ["required_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evaluation_cases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      events_outbox: {
        Row: {
          brand_id: string
          created_at: string
          delivery_status: string
          event_type: string
          id: string
          payload: Json
          retries: number
          tenant_id: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          delivery_status?: string
          event_type: string
          id?: string
          payload: Json
          retries?: number
          tenant_id: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          delivery_status?: string
          event_type?: string
          id?: string
          payload?: Json
          retries?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_outbox_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_outbox_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      founder_capture_raw: {
        Row: {
          brand_id: string | null
          captured_at: string
          captured_from_access_code: string | null
          category: string
          follow_up_answer: string | null
          follow_up_asked: string | null
          founder_answer_text: string
          founder_energy_note: string | null
          id: string
          language_detected: string | null
          question_id: string
          question_text: string
          raw_payload: Json | null
          session_duration_minutes: number | null
          session_id: string | null
          session_number: number | null
          source: string
          tenant_id: string
        }
        Insert: {
          brand_id?: string | null
          captured_at?: string
          captured_from_access_code?: string | null
          category: string
          follow_up_answer?: string | null
          follow_up_asked?: string | null
          founder_answer_text: string
          founder_energy_note?: string | null
          id?: string
          language_detected?: string | null
          question_id: string
          question_text: string
          raw_payload?: Json | null
          session_duration_minutes?: number | null
          session_id?: string | null
          session_number?: number | null
          source?: string
          tenant_id: string
        }
        Update: {
          brand_id?: string | null
          captured_at?: string
          captured_from_access_code?: string | null
          category?: string
          follow_up_answer?: string | null
          follow_up_asked?: string | null
          founder_answer_text?: string
          founder_energy_note?: string | null
          id?: string
          language_detected?: string | null
          question_id?: string
          question_text?: string
          raw_payload?: Json | null
          session_duration_minutes?: number | null
          session_id?: string | null
          session_number?: number | null
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "founder_capture_raw_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "founder_capture_raw_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      insight_review_queue: {
        Row: {
          brand_id: string
          confidence: number
          conflicting_chunk_ids: string[]
          created_at: string
          decay_date: string
          edit_diff: Json | null
          id: string
          language: string
          memory_type: Database["public"]["Enums"]["memory_type"]
          promoted_knowledge_object_id: string | null
          proposed_chunk: Json
          reject_reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          source_kind: string
          source_message_id: string | null
          source_session_id: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          confidence: number
          conflicting_chunk_ids?: string[]
          created_at?: string
          decay_date?: string
          edit_diff?: Json | null
          id?: string
          language?: string
          memory_type: Database["public"]["Enums"]["memory_type"]
          promoted_knowledge_object_id?: string | null
          proposed_chunk: Json
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          source_kind: string
          source_message_id?: string | null
          source_session_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          confidence?: number
          conflicting_chunk_ids?: string[]
          created_at?: string
          decay_date?: string
          edit_diff?: Json | null
          id?: string
          language?: string
          memory_type?: Database["public"]["Enums"]["memory_type"]
          promoted_knowledge_object_id?: string | null
          proposed_chunk?: Json
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          source_kind?: string
          source_message_id?: string | null
          source_session_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "insight_review_queue_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insight_review_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_chunks: {
        Row: {
          brand_id: string
          chunk_index: number
          confidence_score: number | null
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          id: string
          memory_type: Database["public"]["Enums"]["memory_type"]
          metadata: Json
          risk_level: string | null
          source_file: string | null
          source_id: string | null
          tenant_id: string
        }
        Insert: {
          brand_id: string
          chunk_index: number
          confidence_score?: number | null
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          id?: string
          memory_type: Database["public"]["Enums"]["memory_type"]
          metadata?: Json
          risk_level?: string | null
          source_file?: string | null
          source_id?: string | null
          tenant_id: string
        }
        Update: {
          brand_id?: string
          chunk_index?: number
          confidence_score?: number | null
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          id?: string
          memory_type?: Database["public"]["Enums"]["memory_type"]
          metadata?: Json
          risk_level?: string | null
          source_file?: string | null
          source_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_chunks_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "kb_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_chunks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_documents: {
        Row: {
          brand_id: string
          content: string | null
          created_at: string
          id: string
          source_id: string
          status: string
          tenant_id: string
          title: string
          version_label: string
        }
        Insert: {
          brand_id: string
          content?: string | null
          created_at?: string
          id?: string
          source_id: string
          status?: string
          tenant_id: string
          title: string
          version_label?: string
        }
        Update: {
          brand_id?: string
          content?: string | null
          created_at?: string
          id?: string
          source_id?: string
          status?: string
          tenant_id?: string
          title?: string
          version_label?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_documents_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_documents_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "kb_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_review_queue: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string | null
          candidate_fields: Json
          captured_from_access_code: string | null
          confidence_score: number | null
          created_at: string
          edited_fields: Json | null
          extraction_method: string | null
          id: string
          memory_type: Database["public"]["Enums"]["memory_type"] | null
          reviewer_notes: string | null
          risk_level: string | null
          source: string
          source_capture_id: string | null
          source_id: string | null
          status: string
          target_sheet: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string | null
          candidate_fields: Json
          captured_from_access_code?: string | null
          confidence_score?: number | null
          created_at?: string
          edited_fields?: Json | null
          extraction_method?: string | null
          id?: string
          memory_type?: Database["public"]["Enums"]["memory_type"] | null
          reviewer_notes?: string | null
          risk_level?: string | null
          source: string
          source_capture_id?: string | null
          source_id?: string | null
          status?: string
          target_sheet: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string | null
          candidate_fields?: Json
          captured_from_access_code?: string | null
          confidence_score?: number | null
          created_at?: string
          edited_fields?: Json | null
          extraction_method?: string | null
          id?: string
          memory_type?: Database["public"]["Enums"]["memory_type"] | null
          reviewer_notes?: string | null
          risk_level?: string | null
          source?: string
          source_capture_id?: string | null
          source_id?: string | null
          status?: string
          target_sheet?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_review_queue_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_review_queue_source_capture_id_fkey"
            columns: ["source_capture_id"]
            isOneToOne: false
            referencedRelation: "founder_capture_raw"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_review_queue_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_review_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_sources: {
        Row: {
          brand_id: string
          created_at: string
          id: string
          refresh_policy: string
          source_type: string
          source_url: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          id?: string
          refresh_policy?: string
          source_type: string
          source_url?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          id?: string
          refresh_policy?: string
          source_type?: string
          source_url?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_sources_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kb_sources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_objects: {
        Row: {
          approved: boolean
          brand_id: string
          confidence: number | null
          created_at: string
          current_chunk_id: string | null
          current_version: number
          id: string
          language: string
          last_used_at: string | null
          lifecycle_state: string
          memory_type: Database["public"]["Enums"]["memory_type"]
          metadata: Json
          origin_kind: string | null
          origin_review_queue_id: string | null
          related_object_ids: string[]
          tenant_id: string
          updated_at: string
          use_count: number
          versions: Json
        }
        Insert: {
          approved?: boolean
          brand_id: string
          confidence?: number | null
          created_at?: string
          current_chunk_id?: string | null
          current_version?: number
          id?: string
          language?: string
          last_used_at?: string | null
          lifecycle_state?: string
          memory_type: Database["public"]["Enums"]["memory_type"]
          metadata?: Json
          origin_kind?: string | null
          origin_review_queue_id?: string | null
          related_object_ids?: string[]
          tenant_id: string
          updated_at?: string
          use_count?: number
          versions?: Json
        }
        Update: {
          approved?: boolean
          brand_id?: string
          confidence?: number | null
          created_at?: string
          current_chunk_id?: string | null
          current_version?: number
          id?: string
          language?: string
          last_used_at?: string | null
          lifecycle_state?: string
          memory_type?: Database["public"]["Enums"]["memory_type"]
          metadata?: Json
          origin_kind?: string | null
          origin_review_queue_id?: string | null
          related_object_ids?: string[]
          tenant_id?: string
          updated_at?: string
          use_count?: number
          versions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_objects_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_objects_current_chunk_id_fkey"
            columns: ["current_chunk_id"]
            isOneToOne: false
            referencedRelation: "kb_chunks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_objects_origin_review_queue_id_fkey"
            columns: ["origin_review_queue_id"]
            isOneToOne: false
            referencedRelation: "insight_review_queue"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_objects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          brand_id: string
          budget_max: number | null
          budget_min: number | null
          consent_flags: Json
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          intent: string | null
          lead_score: number | null
          lead_status: string
          phone: string | null
          preferred_location: string | null
          session_id: string | null
          tenant_id: string
          timeline: string | null
          updated_at: string
        }
        Insert: {
          brand_id: string
          budget_max?: number | null
          budget_min?: number | null
          consent_flags?: Json
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          intent?: string | null
          lead_score?: number | null
          lead_status?: string
          phone?: string | null
          preferred_location?: string | null
          session_id?: string | null
          tenant_id: string
          timeline?: string | null
          updated_at?: string
        }
        Update: {
          brand_id?: string
          budget_max?: number | null
          budget_min?: number | null
          consent_flags?: Json
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          intent?: string | null
          lead_score?: number | null
          lead_status?: string
          phone?: string | null
          preferred_location?: string | null
          session_id?: string | null
          tenant_id?: string
          timeline?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      market_intelligence_raw: {
        Row: {
          brand_id: string
          competitor_name: string | null
          created_at: string
          expires_at: string
          extraction_confidence: number | null
          extraction_model: string | null
          id: string
          promoted_chunk_ids: string[]
          proposed_chunks: Json
          raw_html: string | null
          raw_metadata: Json
          raw_text: string | null
          review_notes: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          scrape_kind: string
          scraped_at: string
          source_type: string
          source_url: string
          tenant_id: string
        }
        Insert: {
          brand_id: string
          competitor_name?: string | null
          created_at?: string
          expires_at?: string
          extraction_confidence?: number | null
          extraction_model?: string | null
          id?: string
          promoted_chunk_ids?: string[]
          proposed_chunks?: Json
          raw_html?: string | null
          raw_metadata?: Json
          raw_text?: string | null
          review_notes?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scrape_kind?: string
          scraped_at?: string
          source_type: string
          source_url: string
          tenant_id: string
        }
        Update: {
          brand_id?: string
          competitor_name?: string | null
          created_at?: string
          expires_at?: string
          extraction_confidence?: number | null
          extraction_model?: string | null
          id?: string
          promoted_chunk_ids?: string[]
          proposed_chunks?: Json
          raw_html?: string | null
          raw_metadata?: Json
          raw_text?: string | null
          review_notes?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          scrape_kind?: string
          scraped_at?: string
          source_type?: string
          source_url?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_intelligence_raw_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_intelligence_raw_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          brand_id: string
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          tenant_id: string
        }
        Insert: {
          brand_id: string
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          tenant_id: string
        }
        Update: {
          brand_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          brand_id: string
          comez_order_id: string | null
          created_at: string
          currency: string
          customer_id: string | null
          id: string
          line_items: Json
          metadata: Json
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          shipping_address: Json | null
          status: string
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          brand_id: string
          comez_order_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          line_items?: Json
          metadata?: Json
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          shipping_address?: Json | null
          status?: string
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          brand_id?: string
          comez_order_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          line_items?: Json
          metadata?: Json
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          shipping_address?: Json | null
          status?: string
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_demand_signals: {
        Row: {
          asked_bike: string
          asked_product: string
          brand_id: string
          channel: string | null
          created_at: string
          customer_phone_hash: string | null
          id: string
          language: string | null
          notify_consent: boolean
          notify_contact_channel: string | null
          notify_contact_hash: string | null
          raw_message: string | null
          resolved_at: string | null
          resolved_by_sku: string | null
          session_id: string
          tenant_id: string
        }
        Insert: {
          asked_bike: string
          asked_product: string
          brand_id: string
          channel?: string | null
          created_at?: string
          customer_phone_hash?: string | null
          id?: string
          language?: string | null
          notify_consent?: boolean
          notify_contact_channel?: string | null
          notify_contact_hash?: string | null
          raw_message?: string | null
          resolved_at?: string | null
          resolved_by_sku?: string | null
          session_id: string
          tenant_id: string
        }
        Update: {
          asked_bike?: string
          asked_product?: string
          brand_id?: string
          channel?: string | null
          created_at?: string
          customer_phone_hash?: string | null
          id?: string
          language?: string | null
          notify_consent?: boolean
          notify_contact_channel?: string | null
          notify_contact_hash?: string | null
          raw_message?: string | null
          resolved_at?: string | null
          resolved_by_sku?: string | null
          session_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_demand_signals_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_demand_signals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      realtime_turns: {
        Row: {
          brand_id: string
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          tenant_id: string
          turn_index: number
        }
        Insert: {
          brand_id: string
          content: string
          created_at?: string
          id?: string
          role: string
          session_id: string
          tenant_id: string
          turn_index: number
        }
        Update: {
          brand_id?: string
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          tenant_id?: string
          turn_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "realtime_turns_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "realtime_turns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          brand_id: string
          channel: string
          created_at: string
          id: string
          language: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          channel?: string
          created_at?: string
          id?: string
          language?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          channel?: string
          created_at?: string
          id?: string
          language?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string | null
          confidence_score: number | null
          created_at: string
          description: string | null
          display_name: string | null
          id: string
          name: string
          response_strategy: string | null
          risk_level: string
          source_id: string | null
          status: string
          steps: Json
          tenant_id: string
          trigger_description: string
          trigger_examples: string[] | null
          trigger_intents: string[] | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string | null
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          id?: string
          name: string
          response_strategy?: string | null
          risk_level?: string
          source_id?: string | null
          status?: string
          steps: Json
          tenant_id: string
          trigger_description: string
          trigger_examples?: string[] | null
          trigger_intents?: string[] | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string | null
          confidence_score?: number | null
          created_at?: string
          description?: string | null
          display_name?: string | null
          id?: string
          name?: string
          response_strategy?: string | null
          risk_level?: string
          source_id?: string | null
          status?: string
          steps?: Json
          tenant_id?: string
          trigger_description?: string
          trigger_examples?: string[] | null
          trigger_intents?: string[] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          brand_id: string | null
          candidates_extracted: number | null
          candidates_promoted: number | null
          created_at: string
          description: string | null
          display_name: string
          id: string
          last_mined_at: string | null
          notes: string | null
          source_path: string | null
          source_type: string
          source_url: string | null
          source_verified: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string | null
          candidates_extracted?: number | null
          candidates_promoted?: number | null
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          last_mined_at?: string | null
          notes?: string | null
          source_path?: string | null
          source_type: string
          source_url?: string | null
          source_verified?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          brand_id?: string | null
          candidates_extracted?: number | null
          candidates_promoted?: number | null
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          last_mined_at?: string | null
          notes?: string | null
          source_path?: string | null
          source_type?: string
          source_url?: string | null
          source_verified?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sources_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sources_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_capture_tokens: {
        Row: {
          access_code: string
          authority_priority: number | null
          brand_id: string | null
          brand_name: string
          co_founder_names: string[] | null
          created_at: string
          expires_at: string | null
          founder_name: string
          founder_role: string | null
          icp_short: string
          id: string
          is_active: boolean
          notes: string | null
          primary_language: string | null
          specialization_domains: string[] | null
          supported_languages: string[] | null
          tenant_id: string
          typical_geos: string[] | null
          typical_objects: string[] | null
          updated_at: string
          vertical: string
        }
        Insert: {
          access_code: string
          authority_priority?: number | null
          brand_id?: string | null
          brand_name: string
          co_founder_names?: string[] | null
          created_at?: string
          expires_at?: string | null
          founder_name: string
          founder_role?: string | null
          icp_short: string
          id?: string
          is_active?: boolean
          notes?: string | null
          primary_language?: string | null
          specialization_domains?: string[] | null
          supported_languages?: string[] | null
          tenant_id: string
          typical_geos?: string[] | null
          typical_objects?: string[] | null
          updated_at?: string
          vertical: string
        }
        Update: {
          access_code?: string
          authority_priority?: number | null
          brand_id?: string | null
          brand_name?: string
          co_founder_names?: string[] | null
          created_at?: string
          expires_at?: string | null
          founder_name?: string
          founder_role?: string | null
          icp_short?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          primary_language?: string | null
          specialization_domains?: string[] | null
          supported_languages?: string[] | null
          tenant_id?: string
          typical_geos?: string[] | null
          typical_objects?: string[] | null
          updated_at?: string
          vertical?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_capture_tokens_brand_id_fkey"
            columns: ["brand_id"]
            isOneToOne: false
            referencedRelation: "brands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_capture_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_old_chat_turns: { Args: never; Returns: undefined }
      delete_old_realtime_turns: { Args: never; Returns: undefined }
      match_kb_chunks: {
        Args: {
          filter_memory_types?: Database["public"]["Enums"]["memory_type"][]
          match_brand_id: string
          match_count?: number
          match_tenant_id: string
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chunk_index: number
          confidence_score: number
          content: string
          document_id: string
          id: string
          memory_type: Database["public"]["Enums"]["memory_type"]
          metadata: Json
          risk_level: string
          similarity: number
          source_file: string
          source_id: string
        }[]
      }
    }
    Enums: {
      memory_type:
        | "brand"
        | "founder"
        | "product"
        | "customer"
        | "conversation"
        | "faq"
        | "policy"
        | "objection"
        | "market"
        | "decision"
        | "voice"
        | "sales"
        | "escalation"
        | "negative"
        | "proof"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      memory_type: [
        "brand",
        "founder",
        "product",
        "customer",
        "conversation",
        "faq",
        "policy",
        "objection",
        "market",
        "decision",
        "voice",
        "sales",
        "escalation",
        "negative",
        "proof",
      ],
    },
  },
} as const

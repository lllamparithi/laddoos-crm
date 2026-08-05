export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  crm: {
    Tables: {
      account_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by_user_id: string | null
          account_id: string
          created_at: string
          created_by_user_id: string | null
          expires_at: string
          id: string
          label: string | null
          role: Database["crm"]["Enums"]["account_role_enum"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          account_id: string
          created_at?: string
          created_by_user_id?: string | null
          expires_at: string
          id?: string
          label?: string | null
          role: Database["crm"]["Enums"]["account_role_enum"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by_user_id?: string | null
          account_id?: string
          created_at?: string
          created_by_user_id?: string | null
          expires_at?: string
          id?: string
          label?: string | null
          role?: Database["crm"]["Enums"]["account_role_enum"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_invitations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          default_currency: string
          id: string
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_currency?: string
          id?: string
          name: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_currency?: string
          id?: string
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ai_configs: {
        Row: {
          account_id: string
          api_key: string
          auto_reply_enabled: boolean
          auto_reply_max_per_conversation: number
          created_at: string
          created_by: string | null
          embeddings_api_key: string | null
          handoff_agent_id: string | null
          id: string
          is_active: boolean
          model: string
          provider: string
          system_prompt: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          api_key: string
          auto_reply_enabled?: boolean
          auto_reply_max_per_conversation?: number
          created_at?: string
          created_by?: string | null
          embeddings_api_key?: string | null
          handoff_agent_id?: string | null
          id?: string
          is_active?: boolean
          model: string
          provider: string
          system_prompt?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          api_key?: string
          auto_reply_enabled?: boolean
          auto_reply_max_per_conversation?: number
          created_at?: string
          created_by?: string | null
          embeddings_api_key?: string | null
          handoff_agent_id?: string | null
          id?: string
          is_active?: boolean
          model?: string
          provider?: string
          system_prompt?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_configs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_chunks: {
        Row: {
          account_id: string
          chunk_index: number
          content: string
          created_at: string
          document_id: string
          embedding: string | null
          fts: unknown
          id: string
        }
        Insert: {
          account_id: string
          chunk_index?: number
          content: string
          created_at?: string
          document_id: string
          embedding?: string | null
          fts?: unknown
          id?: string
        }
        Update: {
          account_id?: string
          chunk_index?: number
          content?: string
          created_at?: string
          document_id?: string
          embedding?: string | null
          fts?: unknown
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_chunks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "ai_knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_documents: {
        Row: {
          account_id: string
          content: string
          created_at: string
          created_by: string | null
          id: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id: string
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_documents_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_log: {
        Row: {
          account_id: string
          completion_tokens: number
          conversation_id: string | null
          created_at: string
          id: string
          mode: string
          model: string
          prompt_tokens: number
          provider: string
          total_tokens: number
        }
        Insert: {
          account_id: string
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          id?: string
          mode: string
          model: string
          prompt_tokens?: number
          provider: string
          total_tokens?: number
        }
        Update: {
          account_id?: string
          completion_tokens?: number
          conversation_id?: string | null
          created_at?: string
          id?: string
          mode?: string
          model?: string
          prompt_tokens?: number
          provider?: string
          total_tokens?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_log_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_log_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          account_id: string
          automation_id: string
          contact_id: string | null
          created_at: string
          error_message: string | null
          id: string
          status: string
          steps_executed: Json
          trigger_event: string
          user_id: string
        }
        Insert: {
          account_id: string
          automation_id: string
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          status: string
          steps_executed?: Json
          trigger_event: string
          user_id: string
        }
        Update: {
          account_id?: string
          automation_id?: string
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          status?: string
          steps_executed?: Json
          trigger_event?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_pending_executions: {
        Row: {
          account_id: string
          automation_id: string
          branch: string | null
          contact_id: string | null
          context: Json
          created_at: string
          id: string
          log_id: string | null
          next_step_position: number
          parent_step_id: string | null
          run_at: string
          status: string
          user_id: string
        }
        Insert: {
          account_id: string
          automation_id: string
          branch?: string | null
          contact_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          log_id?: string | null
          next_step_position: number
          parent_step_id?: string | null
          run_at: string
          status?: string
          user_id: string
        }
        Update: {
          account_id?: string
          automation_id?: string
          branch?: string | null
          contact_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          log_id?: string | null
          next_step_position?: number
          parent_step_id?: string | null
          run_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_pending_executions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pending_executions_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pending_executions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pending_executions_log_id_fkey"
            columns: ["log_id"]
            isOneToOne: false
            referencedRelation: "automation_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_pending_executions_parent_step_id_fkey"
            columns: ["parent_step_id"]
            isOneToOne: false
            referencedRelation: "automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_steps: {
        Row: {
          automation_id: string
          branch: string | null
          created_at: string
          id: string
          parent_step_id: string | null
          position: number
          step_config: Json
          step_type: string
        }
        Insert: {
          automation_id: string
          branch?: string | null
          created_at?: string
          id?: string
          parent_step_id?: string | null
          position: number
          step_config?: Json
          step_type: string
        }
        Update: {
          automation_id?: string
          branch?: string | null
          created_at?: string
          id?: string
          parent_step_id?: string | null
          position?: number
          step_config?: Json
          step_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_steps_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_steps_parent_step_id_fkey"
            columns: ["parent_step_id"]
            isOneToOne: false
            referencedRelation: "automation_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          execution_count: number
          id: string
          is_active: boolean
          last_executed_at: string | null
          name: string
          trigger_config: Json
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          execution_count?: number
          id?: string
          is_active?: boolean
          last_executed_at?: string | null
          name: string
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          execution_count?: number
          id?: string
          is_active?: boolean
          last_executed_at?: string | null
          name?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          contact_id: string | null
          created_at: string | null
          delivered_at: string | null
          error_message: string | null
          id: string
          read_at: string | null
          replied_at: string | null
          sent_at: string | null
          status: string
          whatsapp_message_id: string | null
        }
        Insert: {
          broadcast_id: string
          contact_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: string
          whatsapp_message_id?: string | null
        }
        Update: {
          broadcast_id?: string
          contact_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          read_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          status?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broadcast_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          account_id: string
          audience_filter: Json | null
          created_at: string | null
          delivered_count: number | null
          failed_count: number | null
          id: string
          name: string
          read_count: number | null
          replied_count: number | null
          scheduled_at: string | null
          sent_count: number | null
          status: string
          template_language: string
          template_name: string
          template_variables: Json | null
          total_recipients: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          audience_filter?: Json | null
          created_at?: string | null
          delivered_count?: number | null
          failed_count?: number | null
          id?: string
          name: string
          read_count?: number | null
          replied_count?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          status?: string
          template_language?: string
          template_name: string
          template_variables?: Json | null
          total_recipients?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          audience_filter?: Json | null
          created_at?: string | null
          delivered_count?: number | null
          failed_count?: number | null
          id?: string
          name?: string
          read_count?: number | null
          replied_count?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          status?: string
          template_language?: string
          template_name?: string
          template_variables?: Json | null
          total_recipients?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcasts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_custom_values: {
        Row: {
          contact_id: string
          created_at: string | null
          custom_field_id: string
          id: string
          value: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          custom_field_id: string
          id?: string
          value?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          custom_field_id?: string
          id?: string
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_custom_values_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_custom_values_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_notes: {
        Row: {
          account_id: string
          contact_id: string
          created_at: string | null
          id: string
          note_text: string
          user_id: string
        }
        Insert: {
          account_id: string
          contact_id: string
          created_at?: string | null
          id?: string
          note_text: string
          user_id: string
        }
        Update: {
          account_id?: string
          contact_id?: string
          created_at?: string | null
          id?: string
          note_text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_notes_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_notes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          contact_id: string
          created_at: string | null
          id: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          id?: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string
          avatar_url: string | null
          company: string | null
          created_at: string | null
          customer_id: string | null
          customer_link_confidence: string | null
          customer_link_source: string | null
          customer_linked_at: string | null
          email: string | null
          id: string
          name: string | null
          phone: string
          phone_normalized: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          avatar_url?: string | null
          company?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_link_confidence?: string | null
          customer_link_source?: string | null
          customer_linked_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          phone: string
          phone_normalized?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          avatar_url?: string | null
          company?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_link_confidence?: string | null
          customer_link_source?: string | null
          customer_linked_at?: string | null
          email?: string | null
          id?: string
          name?: string | null
          phone?: string
          phone_normalized?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          account_id: string
          ai_autoreply_disabled: boolean
          ai_handoff_summary: string | null
          ai_reply_count: number
          assigned_agent_id: string | null
          contact_id: string
          created_at: string | null
          id: string
          last_message_at: string | null
          last_message_text: string | null
          status: string
          unread_count: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          ai_autoreply_disabled?: boolean
          ai_handoff_summary?: string | null
          ai_reply_count?: number
          assigned_agent_id?: string | null
          contact_id: string
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_text?: string | null
          status?: string
          unread_count?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          ai_autoreply_disabled?: boolean
          ai_handoff_summary?: string | null
          ai_reply_count?: number
          assigned_agent_id?: string | null
          contact_id?: string
          created_at?: string | null
          id?: string
          last_message_at?: string | null
          last_message_text?: string | null
          status?: string
          unread_count?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          account_id: string
          created_at: string | null
          field_name: string
          field_options: Json | null
          field_type: string
          id: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          field_name: string
          field_options?: Json | null
          field_type?: string
          id?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          field_name?: string
          field_options?: Json | null
          field_type?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_fields_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          account_id: string
          assigned_to: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string | null
          currency: string | null
          expected_close_date: string | null
          id: string
          notes: string | null
          pipeline_id: string
          stage_id: string
          status: string | null
          title: string
          updated_at: string | null
          user_id: string
          value: number
        }
        Insert: {
          account_id: string
          assigned_to?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          currency?: string | null
          expected_close_date?: string | null
          id?: string
          notes?: string | null
          pipeline_id: string
          stage_id: string
          status?: string | null
          title: string
          updated_at?: string | null
          user_id: string
          value?: number
        }
        Update: {
          account_id?: string
          assigned_to?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string | null
          currency?: string | null
          expected_close_date?: string | null
          id?: string
          notes?: string | null
          pipeline_id?: string
          stage_id?: string
          status?: string | null
          title?: string
          updated_at?: string | null
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "deals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_nodes: {
        Row: {
          config: Json
          created_at: string
          flow_id: string
          id: string
          node_key: string
          node_type: string
          position_x: number
          position_y: number
        }
        Insert: {
          config?: Json
          created_at?: string
          flow_id: string
          id?: string
          node_key: string
          node_type: string
          position_x?: number
          position_y?: number
        }
        Update: {
          config?: Json
          created_at?: string
          flow_id?: string
          id?: string
          node_key?: string
          node_type?: string
          position_x?: number
          position_y?: number
        }
        Relationships: [
          {
            foreignKeyName: "flow_nodes_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_run_events: {
        Row: {
          created_at: string
          event_type: string
          flow_run_id: string
          id: string
          node_key: string | null
          payload: Json
        }
        Insert: {
          created_at?: string
          event_type: string
          flow_run_id: string
          id?: string
          node_key?: string | null
          payload?: Json
        }
        Update: {
          created_at?: string
          event_type?: string
          flow_run_id?: string
          id?: string
          node_key?: string | null
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "flow_run_events_flow_run_id_fkey"
            columns: ["flow_run_id"]
            isOneToOne: false
            referencedRelation: "flow_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      flow_runs: {
        Row: {
          account_id: string
          contact_id: string | null
          conversation_id: string | null
          current_node_key: string | null
          end_reason: string | null
          ended_at: string | null
          flow_id: string
          id: string
          last_advanced_at: string
          last_prompt_message_id: string | null
          reprompt_count: number
          started_at: string
          status: string
          user_id: string
          vars: Json
        }
        Insert: {
          account_id: string
          contact_id?: string | null
          conversation_id?: string | null
          current_node_key?: string | null
          end_reason?: string | null
          ended_at?: string | null
          flow_id: string
          id?: string
          last_advanced_at?: string
          last_prompt_message_id?: string | null
          reprompt_count?: number
          started_at?: string
          status?: string
          user_id: string
          vars?: Json
        }
        Update: {
          account_id?: string
          contact_id?: string | null
          conversation_id?: string | null
          current_node_key?: string | null
          end_reason?: string | null
          ended_at?: string | null
          flow_id?: string
          id?: string
          last_advanced_at?: string
          last_prompt_message_id?: string | null
          reprompt_count?: number
          started_at?: string
          status?: string
          user_id?: string
          vars?: Json
        }
        Relationships: [
          {
            foreignKeyName: "flow_runs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flow_runs_last_prompt_message_id_fkey"
            columns: ["last_prompt_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      flows: {
        Row: {
          account_id: string
          created_at: string
          description: string | null
          entry_node_id: string | null
          execution_count: number
          fallback_policy: Json
          id: string
          last_executed_at: string | null
          name: string
          status: string
          trigger_config: Json
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          description?: string | null
          entry_node_id?: string | null
          execution_count?: number
          fallback_policy?: Json
          id?: string
          last_executed_at?: string | null
          name: string
          status?: string
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          description?: string | null
          entry_node_id?: string | null
          execution_count?: number
          fallback_policy?: Json
          id?: string
          last_executed_at?: string | null
          name?: string
          status?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "flows_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_link_conflicts: {
        Row: {
          brand_id: string
          candidate_customer_ids: string[]
          contact_id: string
          created_at: string
          id: string
          normalized_phone_hash: string
          resolution_notes: string | null
          resolved_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          brand_id: string
          candidate_customer_ids: string[]
          contact_id: string
          created_at?: string
          id?: string
          normalized_phone_hash: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          brand_id?: string
          candidate_customer_ids?: string[]
          contact_id?: string
          created_at?: string
          id?: string
          normalized_phone_hash?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_link_conflicts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      member_presence: {
        Row: {
          account_id: string
          last_seen_at: string
          status: string
          user_id: string
        }
        Insert: {
          account_id: string
          last_seen_at?: string
          status?: string
          user_id: string
        }
        Update: {
          account_id?: string
          last_seen_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_presence_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          actor_id: string | null
          actor_type: string
          conversation_id: string
          created_at: string
          emoji: string
          id: string
          message_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          conversation_id: string
          created_at?: string
          emoji: string
          id?: string
          message_id: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          conversation_id?: string
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          account_id: string
          body_text: string
          buttons: Json | null
          category: string
          created_at: string | null
          footer_text: string | null
          header_content: string | null
          header_handle: string | null
          header_media_url: string | null
          header_type: string | null
          id: string
          language: string | null
          last_submitted_at: string | null
          meta_template_id: string | null
          name: string
          quality_score: string | null
          rejection_reason: string | null
          sample_values: Json | null
          status: string | null
          submission_error: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          body_text: string
          buttons?: Json | null
          category?: string
          created_at?: string | null
          footer_text?: string | null
          header_content?: string | null
          header_handle?: string | null
          header_media_url?: string | null
          header_type?: string | null
          id?: string
          language?: string | null
          last_submitted_at?: string | null
          meta_template_id?: string | null
          name: string
          quality_score?: string | null
          rejection_reason?: string | null
          sample_values?: Json | null
          status?: string | null
          submission_error?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          body_text?: string
          buttons?: Json | null
          category?: string
          created_at?: string | null
          footer_text?: string | null
          header_content?: string | null
          header_handle?: string | null
          header_media_url?: string | null
          header_type?: string | null
          id?: string
          language?: string | null
          last_submitted_at?: string | null
          meta_template_id?: string | null
          name?: string
          quality_score?: string | null
          rejection_reason?: string | null
          sample_values?: Json | null
          status?: string | null
          submission_error?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          ai_generated: boolean
          content_text: string | null
          content_type: string
          conversation_id: string
          created_at: string | null
          id: string
          interactive_payload: Json | null
          interactive_reply_id: string | null
          media_url: string | null
          message_id: string | null
          reply_to_message_id: string | null
          sender_id: string | null
          sender_type: string
          status: string
          template_name: string | null
        }
        Insert: {
          ai_generated?: boolean
          content_text?: string | null
          content_type?: string
          conversation_id: string
          created_at?: string | null
          id?: string
          interactive_payload?: Json | null
          interactive_reply_id?: string | null
          media_url?: string | null
          message_id?: string | null
          reply_to_message_id?: string | null
          sender_id?: string | null
          sender_type: string
          status?: string
          template_name?: string | null
        }
        Update: {
          ai_generated?: boolean
          content_text?: string | null
          content_type?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          interactive_payload?: Json | null
          interactive_reply_id?: string | null
          media_url?: string | null
          message_id?: string | null
          reply_to_message_id?: string | null
          sender_id?: string | null
          sender_type?: string
          status?: string
          template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          account_id: string
          actor_user_id: string | null
          body: string | null
          contact_id: string | null
          conversation_id: string | null
          created_at: string
          id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          account_id: string
          actor_user_id?: string | null
          body?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title: string
          type?: string
          user_id: string
        }
        Update: {
          account_id?: string
          actor_user_id?: string | null
          body?: string | null
          contact_id?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string
          created_at: string | null
          id: string
          name: string
          pipeline_id: string
          position: number
        }
        Insert: {
          color?: string
          created_at?: string | null
          id?: string
          name: string
          pipeline_id: string
          position?: number
        }
        Update: {
          color?: string
          created_at?: string | null
          id?: string
          name?: string
          pipeline_id?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          account_id: string
          created_at: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_id: string
          account_role: Database["crm"]["Enums"]["account_role_enum"]
          avatar_url: string | null
          beta_features: string[]
          created_at: string | null
          email: string
          full_name: string
          id: string
          role: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_id: string
          account_role: Database["crm"]["Enums"]["account_role_enum"]
          avatar_url?: string | null
          beta_features?: string[]
          created_at?: string | null
          email: string
          full_name: string
          id?: string
          role?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_id?: string
          account_role?: Database["crm"]["Enums"]["account_role_enum"]
          avatar_url?: string | null
          beta_features?: string[]
          created_at?: string | null
          email?: string
          full_name?: string
          id?: string
          role?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_replies: {
        Row: {
          account_id: string
          content_text: string | null
          created_at: string
          id: string
          interactive_payload: Json | null
          kind: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          content_text?: string | null
          created_at?: string
          id?: string
          interactive_payload?: Json | null
          kind?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          content_text?: string | null
          created_at?: string
          id?: string
          interactive_payload?: Json | null
          kind?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quick_replies_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          account_id: string
          color: string
          created_at: string | null
          id: string
          name: string
          user_id: string
        }
        Insert: {
          account_id: string
          color?: string
          created_at?: string | null
          id?: string
          name: string
          user_id: string
        }
        Update: {
          account_id?: string
          color?: string
          created_at?: string | null
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          account_id: string
          created_at: string
          created_by: string | null
          events: string[]
          failure_count: number
          id: string
          is_active: boolean
          last_delivery_at: string | null
          secret: string
          url: string
        }
        Insert: {
          account_id: string
          created_at?: string
          created_by?: string | null
          events?: string[]
          failure_count?: number
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          secret: string
          url: string
        }
        Update: {
          account_id?: string
          created_at?: string
          created_by?: string | null
          events?: string[]
          failure_count?: number
          id?: string
          is_active?: boolean
          last_delivery_at?: string | null
          secret?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_config: {
        Row: {
          access_token: string
          account_id: string
          connected_at: string | null
          created_at: string | null
          id: string
          last_registration_error: string | null
          phone_number_id: string
          registered_at: string | null
          status: string
          subscribed_apps_at: string | null
          updated_at: string | null
          user_id: string
          verify_token: string | null
          waba_id: string | null
        }
        Insert: {
          access_token: string
          account_id: string
          connected_at?: string | null
          created_at?: string | null
          id?: string
          last_registration_error?: string | null
          phone_number_id: string
          registered_at?: string | null
          status?: string
          subscribed_apps_at?: string | null
          updated_at?: string | null
          user_id: string
          verify_token?: string | null
          waba_id?: string | null
        }
        Update: {
          access_token?: string
          account_id?: string
          connected_at?: string | null
          created_at?: string | null
          id?: string
          last_registration_error?: string | null
          phone_number_id?: string
          registered_at?: string | null
          status?: string
          subscribed_apps_at?: string | null
          updated_at?: string | null
          user_id?: string
          verify_token?: string | null
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_config_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: true
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_brand_map: {
        Row: {
          brand_id: string
          created_at: string
          crm_workspace_id: string
          id: string
          is_active: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          brand_id: string
          created_at?: string
          crm_workspace_id: string
          id?: string
          is_active?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          brand_id?: string
          created_at?: string
          crm_workspace_id?: string
          id?: string
          is_active?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_brand_map_crm_workspace_id_fkey"
            columns: ["crm_workspace_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _bcast_bump: {
        Args: { bid: string; col: string; delta: number }
        Returns: undefined
      }
      _bcast_cols_for_status: { Args: { s: string }; Returns: string[] }
      claim_ai_reply_slot: {
        Args: { conversation_id: string; max_replies: number }
        Returns: boolean
      }
      filter_contacts_by_tags: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_tag_ids: string[]
        }
        Returns: {
          contact: Database["crm"]["Tables"]["contacts"]["Row"]
          total_count: number
        }[]
      }
      increment_automation_execution_count: {
        Args: { p_automation_id: string }
        Returns: undefined
      }
      increment_flow_execution_count: {
        Args: { p_flow_id: string }
        Returns: undefined
      }
      is_account_member: {
        Args: {
          min_role?: Database["crm"]["Enums"]["account_role_enum"]
          target_account_id: string
        }
        Returns: boolean
      }
      is_linkable_phone_e164: { Args: { normalized: string }; Returns: boolean }
      link_contact_to_customer: {
        Args: { p_contact_id: string }
        Returns: undefined
      }
      match_ai_knowledge_fts: {
        Args: { p_account_id: string; p_match_count: number; p_query: string }
        Returns: {
          content: string
          id: string
          rank: number
        }[]
      }
      match_ai_knowledge_semantic: {
        Args: {
          p_account_id: string
          p_match_count: number
          p_query_embedding: string
        }
        Returns: {
          content: string
          distance: number
          id: string
        }[]
      }
      merge_duplicate_contacts: { Args: never; Returns: number }
      merge_duplicate_conversations: { Args: never; Returns: number }
      normalise_phone_e164: { Args: { raw: string }; Returns: string }
      peek_invitation: { Args: { p_token_hash: string }; Returns: Json }
      recompute_broadcast_counts: { Args: { bid: string }; Returns: undefined }
      reconcile_contact_customer_links: {
        Args: never
        Returns: {
          contacts_ambiguous: number
          contacts_linked: number
          contacts_scanned: number
          contacts_skipped_no_mapping: number
          contacts_unmatched: number
        }[]
      }
      record_webhook_failure: {
        Args: { endpoint_id: string; max_failures: number }
        Returns: undefined
      }
      redeem_invitation: { Args: { p_token_hash: string }; Returns: string }
      remove_account_member: { Args: { p_user_id: string }; Returns: string }
      resolve_customer_candidates: {
        Args: { p_brand_id: string; p_phone: string; p_tenant_id: string }
        Returns: string[]
      }
      set_member_role: {
        Args: {
          p_new_role: Database["crm"]["Enums"]["account_role_enum"]
          p_user_id: string
        }
        Returns: undefined
      }
      touch_presence: { Args: { p_status?: string }; Returns: undefined }
      transfer_account_ownership: {
        Args: { p_new_owner_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      account_role_enum: "owner" | "admin" | "agent" | "viewer"
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
  crm: {
    Enums: {
      account_role_enum: ["owner", "admin", "agent", "viewer"],
    },
  },
} as const


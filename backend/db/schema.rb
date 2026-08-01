# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 11) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"

  create_table "company_infos", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.boolean "enable_sales_deal", default: false
    t.string "hs_access_token"
    t.jsonb "hs_deal_field_mapping", default: {}
    t.string "hs_hub_id"
    t.string "hs_pipeline_id"
    t.string "hs_refresh_token"
    t.jsonb "hs_stage_mapping", default: {}
    t.datetime "hs_token_expires_at"
    t.string "hs_webhook_secret"
    t.string "name"
    t.string "sf_access_token"
    t.string "sf_instance_url"
    t.jsonb "sf_opportunity_field_mapping", default: {}
    t.string "sf_org_id"
    t.string "sf_refresh_token"
    t.jsonb "sf_stage_mapping", default: {}
    t.datetime "sf_token_expires_at"
    t.string "sf_webhook_secret"
    t.datetime "updated_at", null: false
  end

  create_table "hubspot_deals", force: :cascade do |t|
    t.bigint "company_info_id", null: false
    t.datetime "created_at", null: false
    t.jsonb "deal_data", default: {}
    t.string "hubspot_deal_id", null: false
    t.datetime "last_synced_at"
    t.string "payload_hash"
    t.bigint "sales_file_id"
    t.string "status", default: "pending"
    t.datetime "updated_at", null: false
    t.index ["company_info_id", "hubspot_deal_id"], name: "idx_hubspot_deals_on_company_and_hs_id", unique: true
    t.index ["company_info_id"], name: "index_hubspot_deals_on_company_info_id"
    t.index ["sales_file_id"], name: "index_hubspot_deals_on_sales_file_id"
    t.index ["status"], name: "index_hubspot_deals_on_status"
  end

  create_table "hubspot_webhook_logs", force: :cascade do |t|
    t.bigint "company_info_id"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "error_class"
    t.text "error_message"
    t.string "event_type"
    t.text "header_x_forwarded_for"
    t.string "hubspot_deal_id"
    t.jsonb "payload", default: {}, null: false
    t.string "portal_id"
    t.datetime "processed_at"
    t.string "remote_ip"
    t.string "request_id"
    t.string "request_method"
    t.text "request_path"
    t.integer "response_status"
    t.boolean "signature_valid", default: false, null: false
    t.string "status", default: "received", null: false
    t.datetime "updated_at", null: false
    t.text "user_agent"
    t.string "worker_jid"
    t.index ["company_info_id", "created_at"], name: "index_hubspot_webhook_logs_on_company_info_id_and_created_at"
    t.index ["company_info_id"], name: "index_hubspot_webhook_logs_on_company_info_id"
    t.index ["hubspot_deal_id"], name: "index_hubspot_webhook_logs_on_hubspot_deal_id"
    t.index ["portal_id"], name: "index_hubspot_webhook_logs_on_portal_id"
    t.index ["request_id"], name: "index_hubspot_webhook_logs_on_request_id"
    t.index ["status"], name: "index_hubspot_webhook_logs_on_status"
  end

  create_table "sales_files", force: :cascade do |t|
    t.string "broker_comp_producer"
    t.float "closing_probability"
    t.string "closing_quarter"
    t.string "closing_year"
    t.string "company_city"
    t.bigint "company_info_id", null: false
    t.string "company_state"
    t.string "company_street"
    t.string "company_zip"
    t.datetime "created_at", null: false
    t.integer "creator_id"
    t.datetime "crm_imported_at"
    t.string "current_provider"
    t.date "deal_closed_date"
    t.float "deal_size"
    t.string "deal_stage"
    t.datetime "hs_written_at"
    t.string "hubspot_deal_id"
    t.string "hubspot_deal_url"
    t.string "name"
    t.integer "sales_person_id"
    t.string "salesforce_opportunity_id"
    t.string "salesforce_opportunity_url"
    t.datetime "sf_written_at"
    t.datetime "updated_at", null: false
    t.index ["company_info_id", "hubspot_deal_id"], name: "idx_sales_files_on_company_and_hubspot_deal_id", unique: true, where: "(hubspot_deal_id IS NOT NULL)"
    t.index ["company_info_id", "salesforce_opportunity_id"], name: "idx_sales_files_on_company_and_sf_opp_id", unique: true, where: "(salesforce_opportunity_id IS NOT NULL)"
    t.index ["company_info_id"], name: "index_sales_files_on_company_info_id"
  end

  create_table "salesforce_opportunities", force: :cascade do |t|
    t.bigint "company_info_id", null: false
    t.datetime "created_at", null: false
    t.datetime "last_synced_at"
    t.jsonb "opportunity_data", default: {}
    t.string "payload_hash"
    t.bigint "sales_file_id"
    t.string "salesforce_opportunity_id", null: false
    t.string "status", default: "pending"
    t.datetime "updated_at", null: false
    t.index ["company_info_id", "salesforce_opportunity_id"], name: "idx_sf_opps_on_company_and_sf_id", unique: true
    t.index ["company_info_id"], name: "index_salesforce_opportunities_on_company_info_id"
    t.index ["sales_file_id"], name: "index_salesforce_opportunities_on_sales_file_id"
    t.index ["status"], name: "index_salesforce_opportunities_on_status"
  end

  create_table "salesforce_webhook_logs", force: :cascade do |t|
    t.bigint "company_info_id"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "error_class"
    t.text "error_message"
    t.string "event_type"
    t.text "header_x_forwarded_for"
    t.string "org_id"
    t.jsonb "payload", default: {}, null: false
    t.datetime "processed_at"
    t.string "remote_ip"
    t.string "request_id"
    t.string "request_method"
    t.text "request_path"
    t.integer "response_status"
    t.string "salesforce_opportunity_id"
    t.boolean "signature_valid", default: false, null: false
    t.string "status", default: "received", null: false
    t.datetime "updated_at", null: false
    t.text "user_agent"
    t.string "worker_jid"
    t.index ["company_info_id", "created_at"], name: "index_salesforce_webhook_logs_on_company_info_id_and_created_at"
    t.index ["company_info_id"], name: "index_salesforce_webhook_logs_on_company_info_id"
    t.index ["org_id"], name: "index_salesforce_webhook_logs_on_org_id"
    t.index ["request_id"], name: "index_salesforce_webhook_logs_on_request_id"
    t.index ["salesforce_opportunity_id"], name: "index_salesforce_webhook_logs_on_salesforce_opportunity_id"
    t.index ["status"], name: "index_salesforce_webhook_logs_on_status"
  end

  create_table "users", force: :cascade do |t|
    t.bigint "company_info_id"
    t.datetime "created_at", null: false
    t.string "email", default: "", null: false
    t.string "encrypted_password", default: "", null: false
    t.datetime "remember_created_at"
    t.datetime "reset_password_sent_at"
    t.string "reset_password_token"
    t.datetime "updated_at", null: false
    t.index ["company_info_id"], name: "index_users_on_company_info_id"
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["reset_password_token"], name: "index_users_on_reset_password_token", unique: true
  end

  add_foreign_key "hubspot_deals", "company_infos"
  add_foreign_key "hubspot_deals", "sales_files"
  add_foreign_key "hubspot_webhook_logs", "company_infos"
  add_foreign_key "sales_files", "company_infos"
  add_foreign_key "salesforce_opportunities", "company_infos"
  add_foreign_key "salesforce_opportunities", "sales_files"
  add_foreign_key "salesforce_webhook_logs", "company_infos"
  add_foreign_key "users", "company_infos"
end

class AddHubspotToCompanyInfos < ActiveRecord::Migration[7.0]
  def change
    add_column :company_infos, :hs_access_token,      :string
    add_column :company_infos, :hs_refresh_token,     :string
    add_column :company_infos, :hs_token_expires_at,  :datetime
    add_column :company_infos, :hs_hub_id,            :string
    add_column :company_infos, :hs_pipeline_id,       :string
    add_column :company_infos, :hs_stage_mapping,     :jsonb, default: {}
    add_column :company_infos, :hs_deal_field_mapping, :jsonb, default: {}
    add_column :company_infos, :hs_webhook_secret,    :string
  end
end

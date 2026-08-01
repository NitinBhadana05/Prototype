class AddSalesforceToCompanyInfos < ActiveRecord::Migration[7.0]
  def change
    add_column :company_infos, :sf_access_token,               :string
    add_column :company_infos, :sf_refresh_token,              :string
    add_column :company_infos, :sf_instance_url,               :string
    add_column :company_infos, :sf_token_expires_at,           :datetime
    add_column :company_infos, :sf_org_id,                     :string
    add_column :company_infos, :sf_stage_mapping,              :jsonb, default: {}
    add_column :company_infos, :sf_opportunity_field_mapping,  :jsonb, default: {}
    add_column :company_infos, :sf_webhook_secret,             :string
  end
end

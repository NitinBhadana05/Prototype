class AddGmailToCompanyInfos < ActiveRecord::Migration[7.0]
  def change
    add_column :company_infos, :gmail_access_token,      :string
    add_column :company_infos, :gmail_refresh_token,     :string
    add_column :company_infos, :gmail_token_expires_at,  :datetime
    add_column :company_infos, :gmail_email,             :string
    add_column :company_infos, :gmail_account_id,        :string
    add_column :company_infos, :gmail_label_mapping,     :jsonb, default: {}
    add_column :company_infos, :gmail_field_mapping,     :jsonb, default: {}
    add_column :company_infos, :gmail_webhook_secret,    :string
  end
end

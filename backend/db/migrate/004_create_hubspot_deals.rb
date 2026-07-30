class CreateHubspotDeals < ActiveRecord::Migration[7.0]
  def change
    create_table :hubspot_deals do |t|
      t.references :company_info, null: false, foreign_key: true
      t.string :hubspot_deal_id, null: false
      t.jsonb :deal_data, default: {}
      t.string :status, default: "pending"
      t.references :sales_file, foreign_key: true
      t.string :payload_hash
      t.datetime :last_synced_at
      t.timestamps
    end

    add_index :hubspot_deals, [:company_info_id, :hubspot_deal_id],
              unique: true, name: "idx_hubspot_deals_on_company_and_hs_id"
    add_index :hubspot_deals, :status
  end
end

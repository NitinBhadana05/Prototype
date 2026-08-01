class CreateSalesforceOpportunities < ActiveRecord::Migration[7.0]
  def change
    create_table :salesforce_opportunities do |t|
      t.references :company_info, null: false, foreign_key: true
      t.string :salesforce_opportunity_id, null: false
      t.jsonb :opportunity_data, default: {}
      t.string :status, default: "pending"
      t.references :sales_file, foreign_key: true
      t.string :payload_hash
      t.datetime :last_synced_at
      t.timestamps
    end

    add_index :salesforce_opportunities, [:company_info_id, :salesforce_opportunity_id],
              unique: true, name: "idx_sf_opps_on_company_and_sf_id"
    add_index :salesforce_opportunities, :status
  end
end

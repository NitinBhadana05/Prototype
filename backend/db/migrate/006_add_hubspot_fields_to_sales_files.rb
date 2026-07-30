class AddHubspotFieldsToSalesFiles < ActiveRecord::Migration[7.0]
  def change
    add_column :sales_files, :hubspot_deal_id,      :string
    add_column :sales_files, :hubspot_deal_url,     :string
    add_column :sales_files, :hs_written_at,        :datetime
    add_column :sales_files, :broker_comp_producer, :string

    add_index :sales_files, [:company_info_id, :hubspot_deal_id],
              name: "idx_sales_files_on_company_and_hubspot_deal_id",
              unique: true,
              where: "hubspot_deal_id IS NOT NULL"
  end
end

class AddSalesforceFieldsToSalesFiles < ActiveRecord::Migration[7.0]
  def change
    add_column :sales_files, :salesforce_opportunity_id,  :string
    add_column :sales_files, :salesforce_opportunity_url, :string
    add_column :sales_files, :sf_written_at,              :datetime

    add_index :sales_files, [:company_info_id, :salesforce_opportunity_id],
              name: "idx_sales_files_on_company_and_sf_opp_id",
              unique: true,
              where: "salesforce_opportunity_id IS NOT NULL"
  end
end

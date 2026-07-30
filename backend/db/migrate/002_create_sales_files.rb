class CreateSalesFiles < ActiveRecord::Migration[7.0]
  def change
    create_table :sales_files do |t|
      t.references :company_info, null: false, foreign_key: true
      t.string :name
      t.string :deal_stage
      t.float :deal_size
      t.date :deal_closed_date
      t.string :closing_year
      t.string :closing_quarter
      t.float :closing_probability
      t.string :current_provider
      t.string :company_state
      t.string :company_street
      t.string :company_city
      t.string :company_zip
      t.integer :creator_id
      t.integer :sales_person_id
      t.datetime :crm_imported_at
      t.timestamps
    end
  end
end

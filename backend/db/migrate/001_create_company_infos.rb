class CreateCompanyInfos < ActiveRecord::Migration[7.0]
  def change
    create_table :company_infos do |t|
      t.string :name
      t.boolean :enable_sales_deal, default: false
      t.timestamps
    end
  end
end

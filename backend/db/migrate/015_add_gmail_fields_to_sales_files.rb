class AddGmailFieldsToSalesFiles < ActiveRecord::Migration[7.0]
  def change
    add_column :sales_files, :gmail_message_id, :string
    add_column :sales_files, :gmail_thread_id,  :string
    add_column :sales_files, :gmail_written_at,  :datetime

    add_index :sales_files, [:company_info_id, :gmail_message_id],
              name: "idx_sales_files_on_company_and_gmail_msg_id",
              unique: true,
              where: "gmail_message_id IS NOT NULL"
  end
end

class CreateGmailMessages < ActiveRecord::Migration[7.0]
  def change
    create_table :gmail_messages do |t|
      t.references :company_info, null: false, foreign_key: true
      t.string :gmail_message_id, null: false
      t.string :thread_id
      t.jsonb :message_data, default: {}
      t.string :status, default: "pending"
      t.references :sales_file, foreign_key: true
      t.string :payload_hash
      t.datetime :last_synced_at
      t.timestamps
    end

    add_index :gmail_messages, [:company_info_id, :gmail_message_id],
              unique: true, name: "idx_gmail_messages_on_company_and_msg_id"
    add_index :gmail_messages, :status
  end
end

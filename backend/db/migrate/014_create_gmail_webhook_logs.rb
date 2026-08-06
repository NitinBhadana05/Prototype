class CreateGmailWebhookLogs < ActiveRecord::Migration[7.0]
  def change
    create_table :gmail_webhook_logs do |t|
      t.references :company_info, foreign_key: true
      t.string :gmail_message_id
      t.string :event_type
      t.string :status, null: false, default: "received"
      t.string :worker_jid
      t.string :request_id
      t.string :request_method
      t.text :request_path
      t.string :remote_ip
      t.string :content_type
      t.text :user_agent
      t.string :email_account
      t.boolean :signature_valid, null: false, default: false
      t.jsonb :payload, null: false, default: {}
      t.integer :response_status
      t.string :error_class
      t.text :error_message
      t.datetime :processed_at
      t.timestamps
    end

    add_index :gmail_webhook_logs, :status
    add_index :gmail_webhook_logs, :request_id
    add_index :gmail_webhook_logs, [:company_info_id, :created_at]
    add_index :gmail_webhook_logs, :gmail_message_id
    add_index :gmail_webhook_logs, :email_account
  end
end

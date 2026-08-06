class GmailOutboundSyncWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 3

  def perform(sales_file_id, changed_fields = nil)
    sales_file = SalesFile.find_by(id: sales_file_id)
    return unless sales_file

    company = sales_file.company_info
    unless company&.gmail_connected?
      Rails.logger.info("[GmailOutboundSync] Company #{company&.id} not connected to Gmail, skipping")
      return
    end

    service = GmailService.new(company)
    service.ensure_fresh_token!

    # Construct outbound email notification/sync payload
    subject   = "EPHY Deal Update: #{sales_file.name || "Sales File ##{sales_file.id}"}"
    body_text = <<~BODY
      EPHY Deal Update Notification:
      - Deal Name: #{sales_file.name}
      - Stage: #{sales_file.deal_stage}
      - Deal Size: $#{sales_file.deal_size}
      - Producer: #{sales_file.broker_comp_producer}
      - Closing Date: #{sales_file.deal_closed_date}
      - Updated At: #{Time.current}
    BODY

    recipient = company.gmail_email.presence || "deal-notifications@ephy.com"
    response  = service.send_message(to: recipient, subject: subject, body_text: body_text)

    if response.is_a?(Hash) && response["id"].present?
      msg_id = response["id"]
      sales_file.update_columns(
        gmail_message_id: msg_id,
        gmail_thread_id:  response["threadId"],
        gmail_written_at: Time.current
      )

      GmailMessage.find_or_create_by!(
        company_info_id:  company.id,
        gmail_message_id: msg_id
      ) do |gm|
        gm.sales_file_id  = sales_file.id
        gm.thread_id      = response["threadId"]
        gm.message_data   = response
        gm.status         = "imported"
        gm.last_synced_at = Time.current
      end

      Rails.logger.info("[GmailOutboundSync] Sent outbound email for sales_file=#{sales_file_id} msg_id=#{msg_id}")
    else
      Rails.logger.error("[GmailOutboundSync] Failed to send outbound email: #{response.inspect}")
    end
  rescue => e
    Rails.logger.error("[GmailOutboundSync] #{e.class}: #{e.message}")
    raise
  end
end

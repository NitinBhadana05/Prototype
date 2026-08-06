class GmailWebhookProcessWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 3

  def perform(company_id, msg_id, event_type = "message.event", log_id = nil)
    company = CompanyInfo.find_by(id: company_id)
    unless company&.gmail_connected?
      Rails.logger.warn("[GmailWebhookProcess] Company #{company_id} not connected to Gmail")
      return
    end

    log = GmailWebhookLog.find_by(id: log_id) if log_id.present?

    service = GmailService.new(company)
    service.ensure_fresh_token!

    msg_data = service.get_message(msg_id)
    unless msg_data.is_a?(Hash) && msg_data["id"].present?
      log&.update!(status: "failed", error_message: "Message not found: #{msg_data.inspect}")
      return
    end

    # Extract headers
    payload = msg_data["payload"] || {}
    headers = payload["headers"] || []
    
    subject_hdr = headers.find { |h| h["name"]&.downcase == "subject" }&.[]("value")
    from_hdr    = headers.find { |h| h["name"]&.downcase == "from" }&.[]("value")
    date_hdr    = headers.find { |h| h["name"]&.downcase == "date" }&.[]("value")

    subject = subject_hdr.presence || "Gmail Message ##{msg_id}"
    snippet = msg_data["snippet"].to_s

    # Upsert local GmailMessage
    gmail_msg = GmailMessage.find_or_initialize_by(
      company_info_id:  company.id,
      gmail_message_id: msg_id
    )

    gmail_msg.thread_id      = msg_data["threadId"]
    gmail_msg.message_data   = msg_data
    gmail_msg.status         = "imported"
    gmail_msg.last_synced_at = Time.current

    # Create/link corresponding SalesFile
    sales_file = SalesFile.find_or_initialize_by(
      company_info_id:  company.id,
      gmail_message_id: msg_id
    )

    if sales_file.new_record?
      sales_file.name                 = subject
      sales_file.deal_stage           = company.sales_deal_statuses.first || "prospect"
      sales_file.deal_size            = rand(5000..50000)
      sales_file.broker_comp_producer = from_hdr || company.gmail_email
      sales_file.deal_closed_date     = begin
                                          DateTime.parse(date_hdr)
                                        rescue => _e
                                          1.month.from_now
                                        end
      sales_file.crm_imported_at      = Time.current
      sales_file.save!
    end

    service.tag_ephy_write!(sales_file)

    gmail_msg.sales_file_id = sales_file.id
    gmail_msg.save!

    log&.update!(
      status:           "processed",
      gmail_message_id: msg_id,
      processed_at:     Time.current
    )

    Rails.logger.info("[GmailWebhookProcess] Processed msg_id=#{msg_id} -> sales_file=#{sales_file.id}")
  rescue => e
    Rails.logger.error("[GmailWebhookProcess] Error processing msg_id=#{msg_id}: #{e.class} - #{e.message}")
    log&.update!(status: "failed", error_class: e.class.name, error_message: e.message)
    raise
  end
end

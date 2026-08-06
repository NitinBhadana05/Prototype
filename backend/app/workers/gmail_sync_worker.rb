class GmailSyncWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 2

  def perform(company_id)
    company = CompanyInfo.find_by(id: company_id)
    unless company&.gmail_connected?
      Rails.logger.info("[GmailSync] Company #{company_id} not connected to Gmail, skipping")
      return
    end

    service = GmailService.new(company)
    service.ensure_fresh_token!

    enqueued = 0
    page_token = nil

    loop do
      result   = service.list_messages(max_results: 50, page_token: page_token)
      messages = result["messages"] || []
      break if messages.empty?

      messages.each do |msg_stub|
        msg_id = msg_stub["id"]
        next unless msg_id.present?

        next if SalesFile.exists?(gmail_message_id: msg_id, company_info_id: company.id)

        jid = GmailWebhookProcessWorker.perform_async(company.id, msg_id, "message.sync")
        Rails.logger.info("[GmailSync] Enqueued worker for msg_id=#{msg_id} jid=#{jid}")
        enqueued += 1
      end

      page_token = result["nextPageToken"]
      break if page_token.blank? || enqueued >= 100
    end

    Rails.logger.info("[GmailSync] Done for company=#{company_id} enqueued=#{enqueued}")
  rescue => e
    Rails.logger.error("[GmailSync] #{e.class}: #{e.message}")
    raise
  end
end

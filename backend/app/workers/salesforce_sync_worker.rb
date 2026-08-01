class SalesforceSyncWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 2

  def perform(company_id)
    company = CompanyInfo.find_by(id: company_id)
    unless company&.salesforce_connected?
      Rails.logger.info("[SalesforceSync] Company #{company_id} not connected to Salesforce, skipping")
      return
    end

    service = SalesforceService.new(company)
    service.ensure_fresh_token!

    enqueued = 0
    next_records_url = nil

    loop do
      result       = service.list_opportunities(next_records_url: next_records_url)
      opportunities = result["records"] || []
      break if opportunities.empty?

      opportunities.each do |opp|
        sf_id = opp["Id"]
        next unless sf_id.present?

        next if SalesFile.exists?(salesforce_opportunity_id: sf_id, company_info_id: company.id)

        jid = SalesforceWebhookProcessWorker.perform_async(company.id, sf_id, "opportunity.sync")
        Rails.logger.info("[SalesforceSync] Enqueued worker for sf_opp=#{sf_id} jid=#{jid}")
        enqueued += 1
      end

      next_records_url = result["nextRecordsUrl"]
      break if next_records_url.blank?
    end

    Rails.logger.info("[SalesforceSync] Done for company=#{company_id} enqueued=#{enqueued}")
  rescue => e
    Rails.logger.error("[SalesforceSync] #{e.class}: #{e.message}")
    raise
  end
end

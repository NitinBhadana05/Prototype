class HubspotSyncWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 2

  def perform(company_id)
    company = CompanyInfo.find_by(id: company_id)
    unless company&.hubspot_connected?
      Rails.logger.info("[HubspotSync] Company #{company_id} not connected to HubSpot, skipping")
      return
    end

    service = HubspotService.new(company)
    service.ensure_fresh_token!

    enqueued = 0
    after    = nil

    loop do
      result = service.list_deals(after: after)
      deals  = result["results"] || []
      break if deals.empty?

      deals.each do |deal|
        hs_id = deal["id"]
        next unless hs_id.present?

        next if SalesFile.exists?(hubspot_deal_id: hs_id, company_info_id: company.id)

        jid = HubspotWebhookProcessWorker.perform_async(company.id, hs_id, "deal.sync")
        Rails.logger.info("[HubspotSync] Enqueued worker for hs_deal=#{hs_id} jid=#{jid}")
        enqueued += 1
      end

      paging = result.dig("paging", "next", "after")
      break if paging.blank?

      after = paging
    end

    Rails.logger.info("[HubspotSync] Done for company=#{company_id} enqueued=#{enqueued}")
  rescue => e
    Rails.logger.error("[HubspotSync] #{e.class}: #{e.message}")
    raise
  end
end

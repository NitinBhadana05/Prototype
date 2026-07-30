class HubspotSetupWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 3

  def perform(company_id)
    company = CompanyInfo.find_by(id: company_id)
    unless company&.hubspot_connected?
      Rails.logger.warn("[HubspotSetup] Company #{company_id} not found or not connected")
      return
    end

    service = HubspotService.new(company)
    service.ensure_fresh_token!
    results = service.ensure_custom_properties!

    Rails.logger.info("[HubspotSetup] Company #{company_id} — custom properties provisioned: #{results.inspect}")
  rescue => e
    Rails.logger.error("[HubspotSetup] Company #{company_id} — #{e.class}: #{e.message}")
    raise
  end
end

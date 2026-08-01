class SalesforceSetupWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 3

  def perform(company_id)
    company = CompanyInfo.find_by(id: company_id)
    unless company&.salesforce_connected?
      Rails.logger.warn("[SalesforceSetup] Company #{company_id} not found or not connected")
      return
    end

    service = SalesforceService.new(company)
    service.ensure_fresh_token!
    results = service.provision_custom_fields!

    Rails.logger.info("[SalesforceSetup] Company #{company_id} — custom properties provisioned: #{results.inspect}")
  rescue => e
    Rails.logger.error("[SalesforceSetup] Company #{company_id} — #{e.class}: #{e.message}")
    raise
  end
end

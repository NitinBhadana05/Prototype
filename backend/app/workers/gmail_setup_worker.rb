class GmailSetupWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 3

  def perform(company_id)
    company = CompanyInfo.find_by(id: company_id)
    unless company&.gmail_connected?
      Rails.logger.warn("[GmailSetup] Company #{company_id} not found or not connected")
      return
    end

    service = GmailService.new(company)
    service.ensure_fresh_token!
    
    # Fetch user profile to cache email address & account ID
    profile = service.fetch_user_profile
    if profile.is_a?(Hash) && profile["emailAddress"].present?
      company.update!(
        gmail_email:      profile["emailAddress"],
        gmail_account_id: profile["historyId"].to_s
      )
    end

    results = service.provision_custom_labels!
    Rails.logger.info("[GmailSetup] Company #{company_id} — custom labels provisioned: #{results.inspect}")
  rescue => e
    Rails.logger.error("[GmailSetup] Company #{company_id} — #{e.class}: #{e.message}")
    raise
  end
end

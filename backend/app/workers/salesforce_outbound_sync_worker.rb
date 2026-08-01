class SalesforceOutboundSyncWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 3

  def perform(sales_file_id, changed_fields = nil)
    sales_file = SalesFile.find_by(id: sales_file_id)
    return unless sales_file

    company = sales_file.company_info
    return unless company&.salesforce_connected?

    service = SalesforceService.new(company)
    service.ensure_fresh_token!

    mapping = company.sf_opportunity_field_mapping.presence || SalesforceService::DEFAULT_FIELD_MAPPING

    opp_data = {}

    if sales_file.salesforce_opportunity_id.blank?
      # Create new Opportunity in Salesforce
      opp_data["Name"]      = sales_file.name.presence || "New EPHY Deal ##{sales_file.id}"
      opp_data["StageName"] = sales_file.deal_stage.presence || "Prospecting"
      opp_data["Amount"]    = sales_file.deal_size.to_f if sales_file.deal_size.present?
      opp_data["CloseDate"] = (sales_file.deal_closed_date || 30.days.from_now).strftime("%Y-%m-%d")

      res = service.create_opportunity(opp_data)
      if res["id"].present?
        sf_id  = res["id"]
        sf_url = "#{company.sf_instance_url}/#{sf_id}"
        sales_file.update_columns(
          salesforce_opportunity_id:  sf_id,
          salesforce_opportunity_url: sf_url,
          sf_written_at:              Time.current
        )
        SalesforceOpportunity.find_or_create_by(
          company_info_id: company.id,
          salesforce_opportunity_id: sf_id
        ) do |so|
          so.sales_file_id    = sales_file.id
          so.status           = "imported"
          so.opportunity_data = opp_data
          so.last_synced_at   = Time.current
        end
      end
    else
      # Update existing Opportunity
      opp_data["Name"]      = sales_file.name if sales_file.name.present?
      opp_data["StageName"] = sales_file.deal_stage if sales_file.deal_stage.present?
      opp_data["Amount"]    = sales_file.deal_size.to_f if sales_file.deal_size.present?
      opp_data["CloseDate"] = sales_file.deal_closed_date.strftime("%Y-%m-%d") if sales_file.deal_closed_date.present?

      service.update_opportunity(sales_file.salesforce_opportunity_id, opp_data)
      sales_file.update_columns(sf_written_at: Time.current)
    end
  rescue => e
    Rails.logger.error("[SalesforceOutboundSyncWorker] #{e.class}: #{e.message}")
    raise
  end
end

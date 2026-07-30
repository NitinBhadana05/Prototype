class HubspotOutboundSyncWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 3

  def perform(sales_file_id, changed_fields = nil)
    sales_file = SalesFile.find_by(id: sales_file_id)
    unless sales_file
      Rails.logger.warn("[HubspotOutbound] SalesFile #{sales_file_id} not found")
      return
    end

    company = CompanyInfo.find_by(id: sales_file.company_info_id)
    unless company&.hubspot_connected?
      Rails.logger.info("[HubspotOutbound] Company not connected to HubSpot, skipping deal #{sales_file_id}")
      return
    end

    service = HubspotService.new(company)
    service.ensure_fresh_token!

    underwriter_sub = sales_file.underwriter_submissions.order(created_at: :desc).first
    properties      = service.map_ephy_to_hs(sales_file, underwriter_sub, only_fields: changed_fields)

    if sales_file.deal_stage.present? && properties["dealstage"].nil?
      Rails.logger.warn("[HubspotOutbound] No HubSpot stage mapping for EPHY stage '#{sales_file.deal_stage}' on deal #{sales_file.id} — stage will not sync. Configure it in HubSpot > Stage Mapping.")
    end

    if sales_file.hubspot_deal_id.present?
      # Update existing HubSpot deal
      result = service.update_deal(sales_file.hubspot_deal_id, properties)
      log_result("updated", sales_file.id, sales_file.hubspot_deal_id, result)
    else
      # Create new HubSpot deal (EPHY-originated deal pushed to HubSpot)
      properties["dealname"] = sales_file.name.presence || sales_file.current_provider.presence
      properties["pipeline"] = company.hs_pipeline_id if company.hs_pipeline_id.present?

      result = service.create_deal(properties)
      hs_id  = result["id"]

      if hs_id.present?
        hs_url = "https://app.hubspot.com/contacts/#{company.hs_hub_id}/deal/#{hs_id}"
        sales_file.update_columns(
          hubspot_deal_id:  hs_id,
          hubspot_deal_url: hs_url
        )

        # Link EPHY record back on the HubSpot deal
        service.update_deal(hs_id, {
          "ephy_deal_id"  => sales_file.id.to_s,
          "ephy_deal_url" => "#{ENV.fetch('FRONTEND_URL', 'https://chat.ephy.ai')}/main/worksheet?dealId=#{sales_file.id}"
        })

        log_result("created", sales_file.id, hs_id, result)
      else
        Rails.logger.error("[HubspotOutbound] HubSpot deal creation returned no ID for EPHY deal #{sales_file.id}: #{result.inspect}")
        return
      end
    end

    # Stamp loop guard so the resulting HubSpot webhook is ignored
    service.tag_ephy_write!(sales_file)

    log_sync_event(company, sales_file, properties)
  rescue => e
    Rails.logger.error("[HubspotOutbound][error] #{{
      sales_file_id: sales_file_id,
      error_class:   e.class.name,
      error_message: e.message,
      backtrace:     Array(e.backtrace).first(8)
    }.to_json}")
    raise
  end

  private

  def log_result(action, ephy_id, hs_id, result)
    Rails.logger.info("[HubspotOutbound] Deal #{action} ephy=#{ephy_id} hs=#{hs_id} status=#{result.dig('properties', 'hs_lastmodifieddate') || 'ok'}")
  end

  def log_sync_event(company, sales_file, properties)
    HubspotWebhookLog.create!(
      company_info_id: company.id,
      hubspot_deal_id: sales_file.hubspot_deal_id,
      event_type:      "ephy_outbound_sync",
      status:          "sent",
      payload:         { properties: properties, ephy_deal_id: sales_file.id },
      response_status: 200,
      processed_at:    Time.current
    )
  rescue => e
    Rails.logger.error("[HubspotOutbound][log_error] #{e.message}")
  end
end

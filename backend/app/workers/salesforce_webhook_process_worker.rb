class SalesforceWebhookProcessWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 5

  def perform(company_id, sf_opp_id, event_type, webhook_log_id = nil)
    @webhook_log_id = webhook_log_id
    update_webhook_log(status: "worker_started")

    Rails.logger.info("[SalesforceWebhook][worker_start] #{{
      company_id: company_id,
      sf_opp_id: sf_opp_id,
      event_type: event_type
    }.to_json}")

    @company = CompanyInfo.find_by(id: company_id)
    unless @company&.salesforce_connected?
      update_webhook_log(status: "worker_skipped", processed_at: Time.current, error_message: "company_not_connected")
      return
    end

    @service = SalesforceService.new(@company)
    @service.ensure_fresh_token!

    sf_opp = @service.get_opportunity(sf_opp_id)
    unless sf_opp.is_a?(Hash) && sf_opp["Id"].present?
      update_webhook_log(status: "worker_skipped", processed_at: Time.current, error_message: "opportunity_not_found_in_salesforce")
      return
    end

    sales_file = SalesFile.find_by(salesforce_opportunity_id: sf_opp_id, company_info_id: @company.id)

    imported =
      if sales_file
        update_existing_opp(sales_file, sf_opp)
        false
      else
        sales_file = import_opp(sf_opp_id, sf_opp)
        true
      end

    update_webhook_log(
      status: imported ? "worker_imported" : "worker_processed",
      processed_at: Time.current
    )
  rescue => e
    update_webhook_log(
      status: "worker_failed",
      processed_at: Time.current,
      error_class: e.class.name,
      error_message: e.message
    )
    Rails.logger.error("[SalesforceWebhook][worker_error] company=#{company_id} opp=#{sf_opp_id} #{e.class}: #{e.message}")
    raise
  end

  private

  def import_opp(sf_opp_id, sf_opp)
    opp_name = sf_opp["Name"].presence || "Salesforce Opportunity ##{sf_opp_id}"
    stage    = sf_opp["StageName"].presence || "qualification"

    sales_file = SalesFile.create!(
      company_info_id:           @company.id,
      name:                      opp_name,
      current_provider:          opp_name,
      deal_stage:                stage.downcase.gsub(/\s+/, "_"),
      deal_size:                 sf_opp["Amount"].to_f,
      salesforce_opportunity_id: sf_opp_id,
      salesforce_opportunity_url: "#{@company.sf_instance_url}/#{sf_opp_id}",
      sf_written_at:             Time.current
    )

    SalesforceOpportunity.create!(
      company_info_id:           @company.id,
      salesforce_opportunity_id: sf_opp_id,
      sales_file_id:             sales_file.id,
      opportunity_data:          sf_opp,
      status:                    "imported",
      last_synced_at:            Time.current
    )

    sales_file
  end

  def update_existing_opp(sales_file, sf_opp)
    sales_file.update!(
      name:                      sf_opp["Name"].presence || sales_file.name,
      deal_stage:                (sf_opp["StageName"] || sales_file.deal_stage).to_s.downcase.gsub(/\s+/, "_"),
      deal_size:                 sf_opp["Amount"] ? sf_opp["Amount"].to_f : sales_file.deal_size,
      sf_written_at:             Time.current
    )

    sf_record = SalesforceOpportunity.find_by(salesforce_opportunity_id: sf_opp["Id"], company_info_id: @company.id)
    sf_record&.update!(
      opportunity_data: sf_opp,
      last_synced_at:   Time.current,
      status:           "imported"
    )
  end

  def update_webhook_log(attrs)
    return unless @webhook_log_id
    log = SalesforceWebhookLog.find_by(id: @webhook_log_id)
    log&.update(attrs)
  end
end

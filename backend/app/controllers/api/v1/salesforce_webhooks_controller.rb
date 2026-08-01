class Api::V1::SalesforceWebhooksController < ApplicationController
  skip_before_action :verify_authenticity_token

  # POST /api/v1/salesforce/webhook
  def opportunity_event
    raw_payload = webhook_payload
    events      = Array(raw_payload)

    if events.empty?
      return head :ok
    end

    events.each do |event|
      org_id  = (event["OrganizationId"] || event["org_id"]).to_s
      company = CompanyInfo.find_by(sf_org_id: org_id) if org_id.present?

      # If company is not found by org_id, fall back to first connected Salesforce company for prototype
      company ||= CompanyInfo.where.not(sf_access_token: nil).first

      unless company&.salesforce_connected?
        log_webhook(:warn, "ignored_unknown_org", org_id: org_id, payload: event)
        next
      end

      sf_opp_id  = (event["OpportunityId"] || event["Id"] || event["objectId"]).to_s
      event_type = event["EventType"].presence || "opportunity.event"

      webhook_log = create_webhook_log(
        company:   company,
        org_id:    org_id,
        sf_opp_id: sf_opp_id,
        event_type: event_type,
        payload:   event
      )

      jid = SalesforceWebhookProcessWorker.perform_async(
        company.id,
        sf_opp_id,
        event_type,
        webhook_log&.id
      )

      update_webhook_log(webhook_log, status: "enqueued", worker_jid: jid, response_status: 200)
    end

    head :ok
  rescue => e
    Rails.logger.error("[SalesforceWebhook][controller_error] #{e.class}: #{e.message}")
    head :internal_server_error
  end

  private

  def webhook_payload
    raw = request.raw_post.to_s
    if raw.present?
      parsed = JSON.parse(raw)
      parsed.is_a?(Array) ? parsed : [parsed]
    else
      [params.to_unsafe_h.except("controller", "action")]
    end
  rescue JSON::ParserError
    [params.to_unsafe_h.except("controller", "action")]
  end

  def create_webhook_log(company:, org_id:, sf_opp_id:, event_type:, payload:)
    SalesforceWebhookLog.create!(
      company_info_id:           company&.id,
      org_id:                    org_id,
      salesforce_opportunity_id: sf_opp_id,
      event_type:                event_type,
      status:                    "received",
      signature_valid:           true,
      request_id:                request.request_id,
      request_method:            request.request_method,
      request_path:              request.fullpath,
      remote_ip:                 request.remote_ip,
      content_type:              request.content_type,
      user_agent:                request.user_agent,
      header_x_forwarded_for:    request.headers["X-Forwarded-For"],
      payload:                   payload
    )
  rescue => e
    Rails.logger.error("[SalesforceWebhook][db_log_create_error] #{e.class}: #{e.message}")
    nil
  end

  def update_webhook_log(webhook_log, attrs)
    return unless webhook_log
    webhook_log.update(attrs.compact)
  rescue => e
    Rails.logger.error("[SalesforceWebhook][db_log_update_error] #{e.class}: #{e.message}")
  end

  def log_webhook(level, event, org_id:, payload:)
    data = { event: event, org_id: org_id, request_id: request.request_id, remote_ip: request.remote_ip }
    Rails.logger.public_send(level, "[SalesforceWebhook] #{data.to_json}")
  end
end

class Api::V1::HubspotWebhooksController < ApplicationController
  skip_before_action :verify_authenticity_token

  # POST /api/v1/hubspot/webhook
  # Receives an array of events from HubSpot. Each event includes portalId to identify the tenant.
  # Signature is verified using HMAC-SHA256 (X-HubSpot-Signature-v3 header, app-level secret).
  def deal_event
    raw_payload = webhook_payload

    unless HubspotService.valid_webhook_signature?(request)
      log_webhook(:warn, "rejected_invalid_signature", portal_id: nil, payload: raw_payload)
      return head :unauthorized
    end

    events = Array(raw_payload)

    if events.empty?
      log_webhook(:info, "empty_payload", portal_id: nil, payload: raw_payload)
      return head :ok
    end

    events.each do |event|
      portal_id  = event["portalId"].to_s
      company    = CompanyInfo.find_by(hs_hub_id: portal_id) if portal_id.present?

      unless company&.hubspot_connected?
        log_webhook(:warn, "ignored_unknown_portal", portal_id: portal_id, payload: event)
        next
      end

      hs_deal_id = (event["objectId"] || event["dealId"]).to_s
      event_type = build_event_type(event)

      unless hs_deal_id.present?
        log_webhook(:warn, "missing_deal_id", portal_id: portal_id, payload: event)
        next
      end

      webhook_log = create_webhook_log(
        company:    company,
        portal_id:  portal_id,
        hs_deal_id: hs_deal_id,
        event_type: event_type,
        payload:    event
      )

      jid = HubspotWebhookProcessWorker.perform_async(
        company.id,
        hs_deal_id,
        event_type,
        webhook_log&.id
      )

      update_webhook_log(webhook_log, status: "enqueued", worker_jid: jid, response_status: 200)
      log_webhook(:info, "enqueued", portal_id: portal_id, hs_deal_id: hs_deal_id, event_type: event_type, jid: jid, payload: event)
    end

    head :ok
  rescue => e
    Rails.logger.error("[HubspotWebhook][controller_error] #{e.class}: #{e.message}\n#{Array(e.backtrace).first(5).join("\n")}")
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

  def build_event_type(event)
    event["subscriptionType"].to_s.presence || "deal.event"
  end

  def create_webhook_log(company:, portal_id:, hs_deal_id:, event_type:, payload:)
    HubspotWebhookLog.create!(
      company_info_id: company&.id,
      portal_id:       portal_id,
      hubspot_deal_id: hs_deal_id,
      event_type:      event_type,
      status:          "received",
      signature_valid: true,
      request_id:      request.request_id,
      request_method:  request.request_method,
      request_path:    request.fullpath,
      remote_ip:       request.remote_ip,
      content_type:    request.content_type,
      user_agent:      request.user_agent,
      header_x_forwarded_for: request.headers["X-Forwarded-For"],
      payload:         payload
    )
  rescue => e
    Rails.logger.error("[HubspotWebhook][db_log_create_error] #{e.class}: #{e.message}")
    nil
  end

  def update_webhook_log(webhook_log, attrs)
    return unless webhook_log

    webhook_log.update(attrs.compact)
  rescue => e
    Rails.logger.error("[HubspotWebhook][db_log_update_error] #{e.class}: #{e.message}")
  end

  def log_webhook(level, event, portal_id:, payload:, hs_deal_id: nil, event_type: nil, jid: nil)
    data = {
      event:       event,
      portal_id:   portal_id,
      hs_deal_id:  hs_deal_id,
      event_type:  event_type,
      jid:         jid,
      request_id:  request.request_id,
      remote_ip:   request.remote_ip
    }
    Rails.logger.public_send(level, "[HubspotWebhook] #{data.to_json}")
  end
end

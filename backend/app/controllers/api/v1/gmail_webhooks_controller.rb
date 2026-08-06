class Api::V1::GmailWebhooksController < ActionController::API
  # POST /api/v1/gmail/webhook
  def message_event
    payload_raw = request.raw_post
    signature   = request.headers["X-Goog-Signature"] || request.headers["X-Gmail-Signature"]

    company_id  = params[:company_id]
    company     = CompanyInfo.find_by(id: company_id) || CompanyInfo.find_by(gmail_email: params[:email]) || CompanyInfo.first

    log = GmailWebhookLog.create!(
      company_info_id:        company&.id,
      gmail_message_id:       params[:message_id] || params.dig("message", "id"),
      event_type:             params[:event_type] || "message.updated",
      status:                 "received",
      request_id:             request.request_id,
      request_method:         request.request_method,
      request_path:           request.filtered_path,
      remote_ip:              request.remote_ip,
      content_type:           request.content_type,
      user_agent:             request.user_agent,
      email_account:          company&.gmail_email,
      signature_valid:        signature.present?,
      payload:                JSON.parse(payload_raw) rescue { "raw" => payload_raw }
    )

    unless company&.gmail_connected?
      log.update!(status: "rejected", error_message: "Company not connected to Gmail")
      return render json: { error: "Integration disconnected" }, status: :forbidden
    end

    msg_id = params[:message_id] || params.dig("message", "id")
    if msg_id.present?
      jid = GmailWebhookProcessWorker.perform_async(company.id, msg_id, "webhook", log.id)
      log.update!(status: "enqueued", worker_jid: jid)
    else
      log.update!(status: "ignored", error_message: "No msg_id in payload")
    end

    render json: { status: "received", log_id: log.id }, status: :ok
  rescue => e
    Rails.logger.error("[GmailWebhooks] Error handling message_event: #{e.class} - #{e.message}")
    render json: { error: "Internal processing error" }, status: :internal_server_error
  end
end

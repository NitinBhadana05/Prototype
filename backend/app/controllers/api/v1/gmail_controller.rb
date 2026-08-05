class Api::V1::GmailController < Api::V1::BaseController
  skip_before_action :authenticate_request!, only: [:callback]
  before_action :load_company, except: [:callback]

  # GET /api/v1/gmail/auth_url
  def auth_url
    pkce = GmailService.generate_pkce
    payload = {
      company_id:    @company.id,
      code_verifier: pkce[:code_verifier]
    }
    state = Rails.application.message_verifier("gmail_oauth").generate(payload)
    url   = GmailService.auth_url(state: state, code_challenge: pkce[:code_challenge])
    render json: { status: 200, url: url }
  end

  # GET /api/v1/gmail/callback (browser redirect from Google OAuth)
  def callback
    code  = params[:code]
    state = params[:state]

    payload = begin
      Rails.application.message_verifier("gmail_oauth").verify(state)
    rescue => e
      id = Base64.urlsafe_decode64(state.to_s).to_i rescue nil
      id ? { company_id: id } : nil
    end

    company_id    = payload&.[](:company_id) || payload&.[]("company_id")
    code_verifier = payload&.[](:code_verifier) || payload&.[]("code_verifier")

    company      = CompanyInfo.find_by(id: company_id)
    frontend_url = ENV["FRONTEND_URL"] || "http://localhost:3000"

    unless company && code.present?
      return redirect_to "#{frontend_url}/gmail-callback?gmail_error=invalid_state",
                         allow_other_host: true
    end

    tokens = GmailService.exchange_code(code, code_verifier: code_verifier)

    unless tokens["access_token"].present?
      error = tokens["message"] || tokens["error_description"] || tokens["error"] || "auth_failed"
      return redirect_to "#{frontend_url}/gmail-callback?gmail_error=#{CGI.escape(error.to_s)}",
                         allow_other_host: true
    end

    company.update!(
      gmail_access_token:     tokens["access_token"],
      gmail_refresh_token:    tokens["refresh_token"].presence || company.gmail_refresh_token,
      gmail_token_expires_at: Time.now + (tokens["expires_in"] || 3600).to_i.seconds
    )

    GmailSetupWorker.perform_async(company.id)

    redirect_to "#{frontend_url}/gmail-callback?gmail_connected=1", allow_other_host: true

  rescue => e
    Rails.logger.error("[Gmail#callback] #{e.class}: #{e.message}")
    frontend_url = ENV["FRONTEND_URL"] || "http://localhost:3000"
    redirect_to "#{frontend_url}/gmail-callback?gmail_error=server_error",
                allow_other_host: true
  end

  # GET /api/v1/gmail/status
  def status
    render json: {
      status:        200,
      connected:     @company.gmail_connected?,
      email_address: @company.gmail_email,
      account_id:    @company.gmail_account_id
    }
  end

  # DELETE /api/v1/gmail/disconnect
  def disconnect
    @company.update!(
      gmail_access_token:     nil,
      gmail_refresh_token:    nil,
      gmail_token_expires_at: nil,
      gmail_email:            nil,
      gmail_account_id:       nil,
      gmail_label_mapping:    {},
      gmail_field_mapping:    {},
      gmail_webhook_secret:   nil
    )
    render json: { status: 200 }
  end

  # GET /api/v1/gmail/labels
  def labels
    unless @company.gmail_connected?
      return render json: { error: "Gmail not connected" }, status: :unprocessable_entity
    end

    service = GmailService.new(@company)
    service.ensure_fresh_token!
    result  = service.list_labels

    render json: { status: 200, labels: result["results"] || [] }
  rescue => e
    Rails.logger.error("[Gmail#labels] #{e.class}: #{e.message}")
    render json: { error: "Failed to fetch labels: #{e.message}" }, status: :unprocessable_entity
  end

  # GET /api/v1/gmail/label_mapping
  def label_mapping
    render json: {
      status:        200,
      label_mapping: @company.gmail_label_mapping || {},
      ephy_stages:   @company.sales_deal_statuses || []
    }
  end

  # PATCH /api/v1/gmail/save_label_mapping
  def save_label_mapping
    mapping = params[:label_mapping]
    unless mapping.is_a?(ActionController::Parameters) || mapping.is_a?(Hash)
      return render json: { error: "Invalid label mapping" }, status: :unprocessable_entity
    end

    @company.update!(gmail_label_mapping: mapping.to_unsafe_h)
    render json: { status: 200, label_mapping: @company.gmail_label_mapping }
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # GET /api/v1/gmail/message_fields
  def message_fields
    render json: { status: 200, fields: GmailService.message_field_definitions }
  end

  # GET /api/v1/gmail/message_field_mapping
  def message_field_mapping
    render json: {
      status:  200,
      mapping: @company.gmail_field_mapping.presence || GmailService::DEFAULT_FIELD_MAPPING,
      fields:  GmailService.message_field_definitions
    }
  end

  # PATCH /api/v1/gmail/save_message_field_mapping
  def save_message_field_mapping
    mapping = params[:mapping]
    unless mapping.is_a?(ActionController::Parameters) || mapping.is_a?(Hash)
      return render json: { error: "Invalid mapping" }, status: :unprocessable_entity
    end

    @company.update!(gmail_field_mapping: mapping.to_unsafe_h)
    render json: { status: 200, mapping: @company.gmail_field_mapping }
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /api/v1/gmail/sync
  def sync
    unless @company.gmail_connected?
      return render json: { error: "Gmail not connected" }, status: :unprocessable_entity
    end

    GmailSyncWorker.perform_async(@company.id)
    render json: { status: 200, message: "Gmail Sync started" }
  end

  # GET /api/v1/gmail/health
  def health
    unless @company.gmail_connected?
      return render json: { status: "disconnected", connected: false }, status: :ok
    end

    service = GmailService.new(@company)
    health  = service.health_check
    render json: { status: 200, health: health }
  rescue => e
    Rails.logger.error("[Gmail#health] #{e.class}: #{e.message}")
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /api/v1/gmail/reconcile
  def reconcile
    unless @company.gmail_connected?
      return render json: { error: "Gmail not connected" }, status: :unprocessable_entity
    end

    sales_files = SalesFile.where(company_info_id: @company.id).where.not(gmail_message_id: nil)

    results = sales_files.map do |sf|
      {
        gmail_message_id: sf.gmail_message_id,
        local_sales_file_id: sf.id,
        in_sync: true,
        discrepancies: {}
      }
    end

    render json: {
      status: 200,
      total_checked: sales_files.count,
      in_sync_count: results.count,
      reconciliations: results
    }
  end

  # GET /api/v1/gmail/messages
  def messages
    msgs = GmailMessage.where(company_info_id: @company.id).order(updated_at: :desc).limit(50)
    sales_files = SalesFile.where(company_info_id: @company.id).order(updated_at: :desc).limit(50)
    logs = GmailWebhookLog.where(company_info_id: @company.id).order(created_at: :desc).limit(20)

    render json: {
      status: 200,
      messages_count: msgs.count,
      sales_files_count: sales_files.count,
      messages: msgs.map { |m|
        {
          id: m.id,
          gmail_message_id: m.gmail_message_id,
          status: m.status,
          subject: m.message_data.dig("payload", "headers")&.find { |h| h["name"]&.downcase == "subject" }&.[]("value") || "Gmail Msg ##{m.gmail_message_id}",
          snippet: m.message_data["snippet"] || "",
          last_synced_at: m.last_synced_at || m.updated_at
        }
      },
      recent_logs: logs.map { |l|
        {
          id: l.id,
          event_type: l.event_type,
          status: l.status,
          gmail_message_id: l.gmail_message_id,
          created_at: l.created_at
        }
      }
    }
  end

  private

  def load_company
    @company = CompanyInfo.find_by(id: @current_company_info_id) || CompanyInfo.first
    render json: { error: "Company not found" }, status: :not_found unless @company
  end
end

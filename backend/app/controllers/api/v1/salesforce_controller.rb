class Api::V1::SalesforceController < Api::V1::BaseController
  skip_before_action :authenticate_request!, only: [:callback]
  before_action :load_company, except: [:callback]

  # GET /api/v1/salesforce/auth_url
  def auth_url
    pkce = SalesforceService.generate_pkce
    payload = {
      company_id:    @company.id,
      code_verifier: pkce[:code_verifier]
    }
    state = Rails.application.message_verifier("salesforce_oauth").generate(payload)
    url   = SalesforceService.auth_url(state: state, code_challenge: pkce[:code_challenge])
    render json: { status: 200, url: url }
  end

  # GET /api/v1/salesforce/callback (browser redirect from Salesforce OAuth)
  def callback
    code  = params[:code]
    state = params[:state]

    payload = begin
      Rails.application.message_verifier("salesforce_oauth").verify(state)
    rescue => e
      id = Base64.urlsafe_decode64(state.to_s).to_i rescue nil
      id ? { company_id: id } : nil
    end

    company_id    = payload&.[](:company_id) || payload&.[]("company_id")
    code_verifier = payload&.[](:code_verifier) || payload&.[]("code_verifier")

    company      = CompanyInfo.find_by(id: company_id)
    frontend_url = ENV["FRONTEND_URL"] || "http://localhost:3000"

    unless company && code.present?
      return redirect_to "#{frontend_url}/salesforce-callback?sf_error=invalid_state",
                         allow_other_host: true
    end

    tokens = SalesforceService.exchange_code(code, code_verifier: code_verifier)

    unless tokens["access_token"].present?
      error = tokens["message"] || tokens["error_description"] || tokens["error"] || "auth_failed"
      return redirect_to "#{frontend_url}/salesforce-callback?sf_error=#{CGI.escape(error.to_s)}",
                         allow_other_host: true
    end

    org_id = tokens["id"] ? tokens["id"].split("/").last : "sf_org_#{SecureRandom.hex(4)}"

    company.update!(
      sf_access_token:     tokens["access_token"],
      sf_refresh_token:    tokens["refresh_token"],
      sf_instance_url:     tokens["instance_url"].presence || SalesforceService.login_url,
      sf_token_expires_at: Time.now + (tokens["expires_in"] || 7200).to_i.seconds,
      sf_org_id:           org_id
    )

    SalesforceSetupWorker.perform_async(company.id)

    redirect_to "#{frontend_url}/salesforce-callback?sf_connected=1", allow_other_host: true

  rescue => e
    Rails.logger.error("[Salesforce#callback] #{e.class}: #{e.message}")
    frontend_url = ENV["FRONTEND_URL"] || "http://localhost:3000"
    redirect_to "#{frontend_url}/salesforce-callback?sf_error=server_error",
                allow_other_host: true
  end

  # GET /api/v1/salesforce/status
  def status
    render json: {
      status:       200,
      connected:    @company.salesforce_connected?,
      org_id:       @company.sf_org_id,
      instance_url: @company.sf_instance_url
    }
  end

  # DELETE /api/v1/salesforce/disconnect
  def disconnect
    @company.update!(
      sf_access_token:              nil,
      sf_refresh_token:             nil,
      sf_instance_url:              nil,
      sf_token_expires_at:          nil,
      sf_org_id:                    nil,
      sf_stage_mapping:             {},
      sf_opportunity_field_mapping: {},
      sf_webhook_secret:            nil
    )
    render json: { status: 200 }
  end

  # GET /api/v1/salesforce/opportunity_stages
  def opportunity_stages
    unless @company.salesforce_connected?
      return render json: { error: "Salesforce not connected" }, status: :unprocessable_entity
    end

    service = SalesforceService.new(@company)
    service.ensure_fresh_token!
    result  = service.list_opportunity_stages

    render json: { status: 200, stages: result["results"] || [] }
  rescue => e
    Rails.logger.error("[Salesforce#opportunity_stages] #{e.class}: #{e.message}")
    render json: { error: "Failed to fetch stages: #{e.message}" }, status: :unprocessable_entity
  end

  # GET /api/v1/salesforce/stage_mapping
  def stage_mapping
    render json: {
      status:        200,
      stage_mapping: @company.sf_stage_mapping || {},
      ephy_stages:   @company.sales_deal_statuses || []
    }
  end

  # PATCH /api/v1/salesforce/save_stage_mapping
  def save_stage_mapping
    mapping = params[:stage_mapping]
    unless mapping.is_a?(ActionController::Parameters) || mapping.is_a?(Hash)
      return render json: { error: "Invalid stage mapping" }, status: :unprocessable_entity
    end

    @company.update!(sf_stage_mapping: mapping.to_unsafe_h)
    render json: { status: 200, stage_mapping: @company.sf_stage_mapping }
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # GET /api/v1/salesforce/opportunity_fields
  def opportunity_fields
    unless @company.salesforce_connected?
      return render json: { error: "Salesforce not connected" }, status: :unprocessable_entity
    end

    service = SalesforceService.new(@company)
    service.ensure_fresh_token!
    fields  = service.list_opportunity_fields

    render json: { status: 200, fields: fields }
  rescue => e
    Rails.logger.error("[Salesforce#opportunity_fields] #{e.class}: #{e.message}")
    render json: { error: "Failed to fetch opportunity fields: #{e.message}" }, status: :unprocessable_entity
  end

  # GET /api/v1/salesforce/opportunity_field_mapping
  def opportunity_field_mapping
    render json: {
      status:  200,
      mapping: @company.sf_opportunity_field_mapping || {},
      fields:  SalesforceService.opportunity_field_definitions
    }
  end

  # PATCH /api/v1/salesforce/save_opportunity_field_mapping
  def save_opportunity_field_mapping
    mapping = params[:mapping]
    unless mapping.is_a?(ActionController::Parameters) || mapping.is_a?(Hash)
      return render json: { error: "Invalid mapping" }, status: :unprocessable_entity
    end

    @company.update!(sf_opportunity_field_mapping: mapping.to_unsafe_h)
    render json: { status: 200, mapping: @company.sf_opportunity_field_mapping }
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /api/v1/salesforce/sync
  def sync
    unless @company.salesforce_connected?
      return render json: { error: "Salesforce not connected" }, status: :unprocessable_entity
    end

    SalesforceSyncWorker.perform_async(@company.id)
    render json: { status: 200, message: "Salesforce Sync started" }
  end

  # GET /api/v1/salesforce/opportunities
  def opportunities
    opps = SalesforceOpportunity.where(company_info_id: @company.id).order(updated_at: :desc).limit(50)
    sales_files = SalesFile.where(company_info_id: @company.id).order(updated_at: :desc).limit(50)
    logs = SalesforceWebhookLog.where(company_info_id: @company.id).order(created_at: :desc).limit(20)

    render json: {
      status: 200,
      opportunities_count: opps.count,
      sales_files_count: sales_files.count,
      opportunities: opps.map { |o|
        {
          id: o.id,
          salesforce_opportunity_id: o.salesforce_opportunity_id,
          status: o.status,
          opportunity_name: o.opportunity_data["Name"] || "Salesforce Opp ##{o.salesforce_opportunity_id}",
          amount: o.opportunity_data["Amount"] || 0,
          stage: o.opportunity_data["StageName"] || "Unknown",
          last_synced_at: o.last_synced_at || o.updated_at
        }
      },
      recent_logs: logs.map { |l|
        {
          id: l.id,
          event_type: l.event_type,
          status: l.status,
          salesforce_opportunity_id: l.salesforce_opportunity_id,
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

class Api::V1::HubspotController < Api::V1::BaseController
  skip_before_action :authenticate_request!, only: [:callback]
  before_action :load_company, except: [:callback]

  # GET /api/v1/hubspot/auth_url
  def auth_url
    state = Base64.urlsafe_encode64(@company.id.to_s)
    url   = HubspotService.auth_url(state: state)
    render json: { status: 200, url: url }
  end

  # GET /api/v1/hubspot/callback  (browser redirect from HubSpot OAuth)
  def callback
    code  = params[:code]
    state = params[:state]

    company_id   = Base64.urlsafe_decode64(state.to_s).to_i
    company      = CompanyInfo.find_by(id: company_id)
    frontend_url = ENV["FRONTEND_URL"] || "http://localhost:3000"

    unless company && code.present?
      return redirect_to "#{frontend_url}/hubspot-callback?hs_error=invalid_state",
                         allow_other_host: true
    end

    tokens = HubspotService.exchange_code(code)

    unless tokens["access_token"].present?
      error = tokens["message"] || tokens["error"] || "auth_failed"
      return redirect_to "#{frontend_url}/hubspot-callback?hs_error=#{CGI.escape(error)}",
                         allow_other_host: true
    end

    company.update!(
      hs_access_token:     tokens["access_token"],
      hs_refresh_token:    tokens["refresh_token"],
      hs_token_expires_at: Time.now + (tokens["expires_in"] || 21600).to_i.seconds,
      hs_hub_id:           tokens["hub_id"].to_s
    )

    # Auto-create EPHY's custom deal properties in the customer's HubSpot portal
    HubspotSetupWorker.perform_async(company.id)

    redirect_to "#{frontend_url}/hubspot-callback?hs_connected=1", allow_other_host: true

  rescue => e
    Rails.logger.error("[HubSpot#callback] #{e.class}: #{e.message}")
    frontend_url = ENV["FRONTEND_URL"] || "http://localhost:3000"
    redirect_to "#{frontend_url}/hubspot-callback?hs_error=server_error",
                allow_other_host: true
  end

  # GET /api/v1/hubspot/status
  def status
    render json: {
      status:    200,
      connected: @company.hubspot_connected?,
      hub_id:    @company.hs_hub_id
    }
  end

  # DELETE /api/v1/hubspot/disconnect
  def disconnect
    @company.update!(
      hs_access_token:     nil,
      hs_refresh_token:    nil,
      hs_token_expires_at: nil,
      hs_hub_id:           nil,
      hs_pipeline_id:      nil,
      hs_stage_mapping:    {},
      hs_webhook_secret:   nil
    )
    render json: { status: 200 }
  end

  # GET /api/v1/hubspot/pipelines
  def pipelines
    unless @company.hubspot_connected?
      return render json: { error: "HubSpot not connected" }, status: :unprocessable_entity
    end

    service = HubspotService.new(@company)
    service.ensure_fresh_token!
    result = service.list_pipelines

    render json: { status: 200, pipelines: result["results"] || [] }
  rescue => e
    Rails.logger.error("[HubSpot#pipelines] #{e.class}: #{e.message}")
    render json: { error: "Failed to fetch pipelines: #{e.message}" }, status: :unprocessable_entity
  end

  # GET /api/v1/hubspot/pipeline_stages?pipeline_id=xxx
  def pipeline_stages
    unless @company.hubspot_connected?
      return render json: { error: "HubSpot not connected" }, status: :unprocessable_entity
    end

    pipeline_id = params[:pipeline_id].presence || @company.hs_pipeline_id
    unless pipeline_id.present?
      return render json: { error: "pipeline_id is required" }, status: :unprocessable_entity
    end

    service = HubspotService.new(@company)
    service.ensure_fresh_token!
    result  = service.list_pipeline_stages(pipeline_id)

    render json: { status: 200, stages: result["results"] || [] }
  rescue => e
    Rails.logger.error("[HubSpot#pipeline_stages] #{e.class}: #{e.message}")
    render json: { error: "Failed to fetch stages: #{e.message}" }, status: :unprocessable_entity
  end

  # GET /api/v1/hubspot/stage_mapping
  def stage_mapping
    render json: {
      status:        200,
      stage_mapping: @company.hs_stage_mapping || {},
      ephy_stages:   @company.sales_deal_statuses || [],
      pipeline_id:   @company.hs_pipeline_id
    }
  end

  # PATCH /api/v1/hubspot/stage_mapping
  def save_stage_mapping
    mapping = params[:stage_mapping]
    unless mapping.is_a?(ActionController::Parameters) || mapping.is_a?(Hash)
      return render json: { error: "Invalid stage mapping" }, status: :unprocessable_entity
    end

    pipeline_id = params[:pipeline_id]
    update_attrs = { hs_stage_mapping: mapping.to_unsafe_h }
    update_attrs[:hs_pipeline_id] = pipeline_id if pipeline_id.present?

    @company.update!(update_attrs)
    render json: { status: 200, stage_mapping: @company.hs_stage_mapping }
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # GET /api/v1/hubspot/deal_field_mapping
  def deal_field_mapping
    render json: {
      status:  200,
      mapping: @company.hs_deal_field_mapping || {},
      fields:  HubspotService.deal_field_definitions
    }
  end

  # PATCH /api/v1/hubspot/deal_field_mapping
  def save_deal_field_mapping
    mapping = params[:mapping]
    unless mapping.is_a?(ActionController::Parameters) || mapping.is_a?(Hash)
      return render json: { error: "Invalid mapping" }, status: :unprocessable_entity
    end

    @company.update!(hs_deal_field_mapping: mapping.to_unsafe_h)
    render json: { status: 200, mapping: @company.hs_deal_field_mapping }
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /api/v1/hubspot/sync
  # Kicks off a background job that paginates all HubSpot deals and enqueues an import
  # worker for each deal not yet in EPHY. Returns immediately.
  def sync
    unless @company.hubspot_connected?
      return render json: { error: "HubSpot not connected" }, status: :unprocessable_entity
    end

    HubspotSyncWorker.perform_async(@company.id)
    render json: { status: 200, message: "Sync started" }
  end

  private

  def load_company
    @company = CompanyInfo.find_by(id: @current_company_info_id)
    render json: { error: "Company not found" }, status: :not_found unless @company
  end
end

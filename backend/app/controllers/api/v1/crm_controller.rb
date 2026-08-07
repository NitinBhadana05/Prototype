class Api::V1::CrmController < Api::V1::BaseController
  before_action :load_company

  # GET /api/v1/crm/status
  def status
    hs_connected    = @company.hubspot_connected?
    sf_connected    = @company.salesforce_connected?
    gmail_connected = @company.gmail_connected?

    hs_deals_count    = HubspotDeal.where(company_info_id: @company.id).count
    sf_opps_count     = SalesforceOpportunity.where(company_info_id: @company.id).count
    gmail_msgs_count  = GmailMessage.where(company_info_id: @company.id).count
    total_sales_files = SalesFile.where(company_info_id: @company.id).count

    # Deals linked to both CRMs simultaneously
    dual_synced_count = SalesFile.where(company_info_id: @company.id)
                                 .where.not(hubspot_deal_id: nil)
                                 .where.not(salesforce_opportunity_id: nil)
                                 .count

    render json: {
      status: 200,
      hubspot: {
        connected: hs_connected,
        hub_id:    @company.hs_hub_id,
        deals_count: hs_deals_count
      },
      salesforce: {
        connected: sf_connected,
        org_id:    @company.sf_org_id,
        instance_url: @company.sf_instance_url,
        opportunities_count: sf_opps_count
      },
      gmail: {
        connected: gmail_connected,
        email:     @company.gmail_email,
        messages_count: gmail_msgs_count
      },
      cross_crm: {
        active: (hs_connected && sf_connected) || (gmail_connected && (hs_connected || sf_connected)),
        total_ephy_deals: total_sales_files,
        dual_synced_deals: dual_synced_count,
        mode: "Multi-Platform Bi-directional Sync (HubSpot ↔ EPHY ↔ Salesforce ↔ Gmail)"
      }
    }
  end

  # POST /api/v1/crm/sync_all
  def sync_all
    enqueued = []

    if @company.hubspot_connected?
      HubspotSyncWorker.perform_async(@company.id)
      enqueued << "HubSpot"
    end

    if @company.salesforce_connected?
      SalesforceSyncWorker.perform_async(@company.id)
      enqueued << "Salesforce"
    end

    if @company.gmail_connected?
      GmailSyncWorker.perform_async(@company.id)
      enqueued << "Gmail"
    end

    if enqueued.empty?
      return render json: { error: "No integrations (HubSpot, Salesforce, or Gmail) are connected" }, status: :unprocessable_entity
    end

    render json: {
      status: 200,
      message: "Unified sync started for #{enqueued.join(', ')}",
      synced_integrations: enqueued
    }
  end

  # POST /api/v1/crm/reconcile
  def reconcile
    dual_files = SalesFile.where(company_info_id: @company.id)
                          .where.not(hubspot_deal_id: nil)
                          .where.not(salesforce_opportunity_id: nil)

    reconciled = 0
    dual_files.each do |file|
      file.touch # triggers after_commit sync to both CRMs
      reconciled += 1
    end

    render json: {
      status: 200,
      message: "Cross-CRM reconciliation triggered for #{reconciled} dual-synced entities.",
      reconciled_count: reconciled
    }
  end

  private

  def load_company
    @company = CompanyInfo.find_by(id: @current_company_info_id) || CompanyInfo.first
    render json: { error: "Company not found" }, status: :not_found unless @company
  end
end

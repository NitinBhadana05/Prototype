class Api::V1::CrmController < Api::V1::BaseController
  before_action :load_company

  # GET /api/v1/crm/status
  def status
    hs_connected = @company.hubspot_connected?
    sf_connected = @company.salesforce_connected?

    hs_deals_count = HubspotDeal.where(company_info_id: @company.id).count
    sf_opps_count  = SalesforceOpportunity.where(company_info_id: @company.id).count
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
      cross_crm: {
        active: hs_connected && sf_connected,
        total_ephy_deals: total_sales_files,
        dual_synced_deals: dual_synced_count,
        mode: "Bi-directional Cross-CRM Sync (HubSpot ↔ EPHY ↔ Salesforce)"
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

    if enqueued.empty?
      return render json: { error: "Neither HubSpot nor Salesforce is connected" }, status: :unprocessable_entity
    end

    render json: {
      status: 200,
      message: "Unified sync started for #{enqueued.join(' and ')}",
      synced_integrations: enqueued
    }
  end

  private

  def load_company
    @company = CompanyInfo.find_by(id: @current_company_info_id) || CompanyInfo.first
    render json: { error: "Company not found" }, status: :not_found unless @company
  end
end

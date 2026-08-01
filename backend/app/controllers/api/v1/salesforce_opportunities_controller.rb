class Api::V1::SalesforceOpportunitiesController < Api::V1::BaseController
  before_action :load_company
  before_action :load_opportunity, only: [:destroy, :import]

  # GET /api/v1/salesforce_opportunities
  def index
    opps = SalesforceOpportunity.where(company_info_id: @company.id).order(updated_at: :desc)
    render json: {
      status: 200,
      opportunities: opps.map { |o|
        {
          id: o.id,
          salesforce_opportunity_id: o.salesforce_opportunity_id,
          status: o.status,
          opportunity_name: o.opportunity_data["Name"] || "Salesforce Opp ##{o.salesforce_opportunity_id}",
          amount: o.opportunity_data["Amount"] || 0,
          stage: o.opportunity_data["StageName"] || "Unknown",
          sales_file_id: o.sales_file_id,
          last_synced_at: o.last_synced_at || o.updated_at
        }
      }
    }
  end

  # DELETE /api/v1/salesforce_opportunities/:id
  def destroy
    @opportunity.destroy
    render json: { status: 200, message: "Opportunity record deleted" }
  end

  # POST /api/v1/salesforce_opportunities/:id/import
  def import
    sf_opp_id = @opportunity.salesforce_opportunity_id
    jid = SalesforceWebhookProcessWorker.perform_async(@company.id, sf_opp_id, "opportunity.import")
    render json: { status: 200, message: "Import enqueued", worker_jid: jid }
  end

  private

  def load_company
    @company = CompanyInfo.find_by(id: @current_company_info_id) || CompanyInfo.first
    render json: { error: "Company not found" }, status: :not_found unless @company
  end

  def load_opportunity
    @opportunity = SalesforceOpportunity.find_by(id: params[:id], company_info_id: @company.id)
    render json: { error: "Opportunity not found" }, status: :not_found unless @opportunity
  end
end

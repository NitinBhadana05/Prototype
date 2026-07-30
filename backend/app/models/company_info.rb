class CompanyInfo < ApplicationRecord
  has_many :sales_files, dependent: :destroy
  has_many :hubspot_deals, dependent: :destroy
  has_many :hubspot_webhook_logs, dependent: :nullify
  has_many :users, dependent: :nullify

  def hubspot_connected?
    hs_access_token.present?
  end

  def sales_deal_statuses
    %w[prospect qualification proposal negotiation closed_won closed_lost]
  end
end

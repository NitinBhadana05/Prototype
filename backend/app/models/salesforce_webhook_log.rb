class SalesforceWebhookLog < ApplicationRecord
  belongs_to :company_info, optional: true
end

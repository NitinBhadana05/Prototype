class GmailWebhookLog < ApplicationRecord
  belongs_to :company_info, optional: true
end

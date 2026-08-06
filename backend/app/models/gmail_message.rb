class GmailMessage < ApplicationRecord
  belongs_to :company_info
  belongs_to :sales_file, optional: true

  STATUSES = %w[pending imported rejected].freeze

  validates :gmail_message_id, presence: true,
            uniqueness: { scope: :company_info_id }
  validates :status, inclusion: { in: STATUSES }
end

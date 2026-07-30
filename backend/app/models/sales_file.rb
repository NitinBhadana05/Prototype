class SalesFile < ApplicationRecord
  belongs_to :company_info
  has_many :hubspot_deals, dependent: :nullify

  after_commit :sync_to_hubspot, on: [:create, :update], if: :should_sync_to_hubspot?

  HS_SYNCABLE_FIELDS = %w[
    deal_stage deal_closed_date closing_probability deal_size
    broker_comp_producer
  ].freeze

  private

  def should_sync_to_hubspot?
    if saved_change_to_id?
      return false if hubspot_deal_id.present?
      return company_info&.hubspot_connected? == true
    end
    return false unless hubspot_deal_id.present?
    HS_SYNCABLE_FIELDS.any? { |f| saved_change_to_attribute?(f) }
  end

  def sync_to_hubspot
    return if hs_written_at.present? && hs_written_at > 10.seconds.ago
    changed_fields = saved_change_to_id? ? nil : (saved_changes.keys & HS_SYNCABLE_FIELDS)
    HubspotOutboundSyncWorker.perform_in(5.seconds, id, changed_fields)
  end
end

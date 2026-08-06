class SalesFile < ApplicationRecord
  belongs_to :company_info
  has_many :hubspot_deals, dependent: :nullify
  has_many :salesforce_opportunities, dependent: :nullify
  has_many :gmail_messages, dependent: :nullify

  after_commit :sync_to_hubspot, on: [:create, :update], if: :should_sync_to_hubspot?
  after_commit :sync_to_salesforce, on: [:create, :update], if: :should_sync_to_salesforce?
  after_commit :sync_to_gmail, on: [:create, :update], if: :should_sync_to_gmail?

  HS_SYNCABLE_FIELDS = %w[
    deal_stage deal_closed_date closing_probability deal_size
    broker_comp_producer
  ].freeze

  SF_SYNCABLE_FIELDS = %w[
    deal_stage deal_closed_date closing_probability deal_size
    broker_comp_producer
  ].freeze

  GMAIL_SYNCABLE_FIELDS = %w[
    name deal_stage deal_size broker_comp_producer
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

  def should_sync_to_salesforce?
    if saved_change_to_id?
      return false if salesforce_opportunity_id.present?
      return company_info&.salesforce_connected? == true
    end
    return false unless salesforce_opportunity_id.present?
    SF_SYNCABLE_FIELDS.any? { |f| saved_change_to_attribute?(f) }
  end

  def sync_to_salesforce
    return if sf_written_at.present? && sf_written_at > 10.seconds.ago
    changed_fields = saved_change_to_id? ? nil : (saved_changes.keys & SF_SYNCABLE_FIELDS)
    SalesforceOutboundSyncWorker.perform_in(5.seconds, id, changed_fields)
  end

  def should_sync_to_gmail?
    if saved_change_to_id?
      return false if gmail_message_id.present?
      return company_info&.gmail_connected? == true
    end
    return false unless gmail_message_id.present?
    GMAIL_SYNCABLE_FIELDS.any? { |f| saved_change_to_attribute?(f) }
  end

  def sync_to_gmail
    return if gmail_written_at.present? && gmail_written_at > 10.seconds.ago
    changed_fields = saved_change_to_id? ? nil : (saved_changes.keys & GMAIL_SYNCABLE_FIELDS)
    GmailOutboundSyncWorker.perform_in(5.seconds, id, changed_fields)
  end
end

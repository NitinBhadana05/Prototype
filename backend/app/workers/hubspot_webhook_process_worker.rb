class HubspotWebhookProcessWorker
  include Sidekiq::Worker

  sidekiq_options queue: :default, retry: 5

  def perform(company_id, hs_deal_id, event_type, webhook_log_id = nil)
    @webhook_log_id = webhook_log_id
    update_webhook_log(status: "worker_started")

    Rails.logger.info("[HubspotWebhook][worker_start] #{{
      company_id: company_id,
      hs_deal_id: hs_deal_id,
      event_type: event_type
    }.to_json}")

    @company = CompanyInfo.find_by(id: company_id)
    unless @company&.hubspot_connected?
      update_webhook_log(status: "worker_skipped", processed_at: Time.current, error_message: "company_not_connected")
      return
    end

    @service = HubspotService.new(@company)
    @service.ensure_fresh_token!

    hs_deal = @service.fetch_deal(hs_deal_id)
    unless hs_deal&.dig("id").present?
      update_webhook_log(status: "worker_skipped", processed_at: Time.current, error_message: "deal_not_found_in_hubspot")
      Rails.logger.warn("[HubspotWebhook][worker_skip] deal_not_found company=#{company_id} hs_deal=#{hs_deal_id}")
      return
    end

    properties  = hs_deal["properties"] || {}
    hs_stage_id = properties["dealstage"].to_s
    ephy_stage  = @service.ephy_stage_for_hs_stage(hs_stage_id)

    sales_file = SalesFile.find_by(hubspot_deal_id: hs_deal_id, company_info_id: @company.id)

    imported =
      if sales_file
        update_existing_deal(sales_file, properties, hs_stage_id, ephy_stage)
        false
      else
        sales_file = import_deal(hs_deal_id, hs_deal, properties, hs_stage_id, ephy_stage)
        true
      end

    if properties["underwriter_form_sent_at"].present? && sales_file&.id.present?
      trigger_census_template_send(sales_file.id)
    end

    update_webhook_log(
      status: imported ? "worker_imported" : "worker_processed",
      processed_at: Time.current
    )
  rescue => e
    update_webhook_log(
      status: "worker_failed",
      processed_at: Time.current,
      error_class: e.class.name,
      error_message: e.message
    )
    Rails.logger.error("[HubspotWebhook][worker_error] #{{
      company_id: company_id,
      hs_deal_id: hs_deal_id,
      error_class: e.class.name,
      error_message: e.message,
      backtrace: Array(e.backtrace).first(8)
    }.to_json}")
    raise
  end

  private

  def import_deal(hs_deal_id, hs_deal, properties, hs_stage_id, ephy_stage)
    contact_data  = extract_primary_contact(hs_deal)
    company_data  = extract_company_data(hs_deal)
    mapping_attrs = @service.map_hs_to_ephy(properties)

    attrs = {
      current_provider: properties["dealname"].presence || "HubSpot Import",
      name:             properties["dealname"].presence || "HubSpot Import",
      company_info_id:  @company.id,
      deal_stage:       ephy_stage.presence || "deal_creation",
      hubspot_deal_id:  hs_deal_id,
      creator_id:       @company.user&.id,
      deal_size:        properties["amount"].to_i,
    }.merge(mapping_attrs)

    attrs[:name]             = company_data[:name].presence || attrs[:name] if company_data[:name].present?
    attrs[:current_provider] = company_data[:name] || attrs[:name]          if company_data[:name].present?
    attrs[:company_state]    = company_data[:state]                         if company_data[:state].present?
    attrs[:company_street]   = company_data[:street]                        if company_data[:street].present?
    attrs[:company_city]     = company_data[:city]                          if company_data[:city].present?
    attrs[:company_zip]      = company_data[:zip]                           if company_data[:zip].present?

    if contact_data[:email].present?
      sales_person            = @company.users.find_by(email: contact_data[:email])
      attrs[:sales_person_id] = sales_person&.id
      attrs[:creator_id]      = sales_person&.id || attrs[:creator_id]
    end

    attrs.compact!

    hs_created_at = parse_hs_datetime(properties["createdate"])

    sales_file = SalesFile.create!(attrs.merge(
      crm_imported_at: Time.current,
      created_at:      hs_created_at || Time.current
    ))

    begin
      @service.update_deal(hs_deal_id, {
        "ephy_deal_id"  => sales_file.id.to_s,
        "ephy_deal_url" => "#{ENV.fetch('FRONTEND_URL', 'https://chat.ephy.ai')}/main/worksheet?dealId=#{sales_file.id}"
      })
      @service.tag_ephy_write!(sales_file)
    rescue => e
      Rails.logger.error("[HubspotWebhook] Failed to write ephy_deal_id back to HubSpot: #{e.message}")
    end

    Rails.logger.info("[HubspotWebhook] Auto-created deal #{sales_file.id} from HS deal #{hs_deal_id}")
    broadcast_deal_update(sales_file)
    sales_file
  end

  def update_existing_deal(sales_file, properties, hs_stage_id, ephy_stage)
    if sales_file.hs_written_at.present? && sales_file.hs_written_at > 15.seconds.ago
      Rails.logger.info("[HubspotWebhook] Loop guard: skipping update for deal #{sales_file.id}")
      return
    end

    update_attrs = @service.map_hs_to_ephy(properties)
    update_attrs[:deal_stage] = ephy_stage if ephy_stage.present? && ephy_stage != sales_file.deal_stage

    if ["closedwon", "closed_won"].include?(hs_stage_id.downcase) || ephy_stage == "won"
      update_attrs[:deal_stage] = "won"
    elsif ["closedlost", "closed_lost"].include?(hs_stage_id.downcase) || ephy_stage == "lost"
      update_attrs[:deal_stage] = "lost"
    end

    return if update_attrs.blank?

    # EPHY is authoritative for pricing — never overwrite from HubSpot
    update_attrs.delete(:deal_size)
    update_attrs.delete(:census_count)
    update_attrs.delete(:employee_count)

    # Stamp before update so the after_commit callback skips the outbound push back to HubSpot
    @service.tag_ephy_write!(sales_file)
    sales_file.update!(update_attrs.compact)
    Rails.logger.info("[HubspotWebhook] Updated deal #{sales_file.id} stage=#{update_attrs[:deal_stage]} from HS")
    broadcast_deal_update(sales_file)
  end

  def trigger_census_template_send(sales_file_id)
    sales_file = SalesFile.find_by(id: sales_file_id)
    return unless sales_file
    return if sales_file.census_template_sent_at.present?

    CensusTemplateSendWorker.perform_async(sales_file_id)
    sales_file.update_column(:census_template_sent_at, Time.current)
    Rails.logger.info("[HubspotWebhook] Enqueued census template send for deal #{sales_file_id}")
  rescue => e
    Rails.logger.error("[HubspotWebhook] Census template trigger failed for deal #{sales_file_id}: #{e.message}")
  end

  def extract_primary_contact(hs_deal)
    contacts = hs_deal.dig("associations", "contacts", "results") || []

    if contacts.empty?
      assoc    = @service.fetch_deal_associations(hs_deal["id"], "contacts")
      contacts = assoc.dig("results") || []
    end

    if contacts.present?
      contact_data = @service.fetch_contact(contacts.first["id"])
      props        = contact_data["properties"] || {}
      return {
        email: props["email"],
        name:  [props["firstname"], props["lastname"]].compact.join(" ").presence,
        phone: props["phone"]
      }
    end

    owner_id = hs_deal.dig("properties", "hubspot_owner_id").presence
    return {} unless owner_id

    owner = @service.fetch_owner(owner_id)
    {
      email: owner["email"],
      name:  [owner["firstName"], owner["lastName"]].compact.join(" ").presence
    }
  rescue => e
    Rails.logger.warn("[HubspotWebhook] Could not fetch contact: #{e.message}")
    {}
  end

  def extract_company_data(hs_deal)
    companies = hs_deal.dig("associations", "companies", "results") || []

    if companies.empty?
      assoc     = @service.fetch_deal_associations(hs_deal["id"], "companies")
      companies = assoc.dig("results") || []
    end

    return {} if companies.empty?

    company_data = @service.fetch_company(companies.first["id"])
    props        = company_data["properties"] || {}

    {
      name:   props["name"],
      state:  props["state"],
      street: props["address"],
      city:   props["city"],
      zip:    props["zip"]
    }
  rescue => e
    Rails.logger.warn("[HubspotWebhook] Could not fetch company: #{e.message}")
    {}
  end

  # HubSpot returns datetime values either as millisecond epoch strings ("1683936000000")
  # or ISO 8601 strings ("2023-05-13T00:00:00.000Z"). Handle both.
  def parse_hs_datetime(value)
    return nil if value.blank?
    value.to_s =~ /\A\d{10,13}\z/ ? Time.at(value.to_i / 1000.0) : Time.parse(value.to_s)
  rescue ArgumentError, TypeError
    nil
  end

  def webhook_log
    return nil if @webhook_log_id.blank?
    @webhook_log ||= HubspotWebhookLog.find_by(id: @webhook_log_id)
  end

  def update_webhook_log(attrs)
    return unless webhook_log
    webhook_log.update(attrs.compact)
  rescue => e
    Rails.logger.error("[HubspotWebhook][db_log_update_error] #{e.class}: #{e.message}")
  end

  def broadcast_deal_update(sales_file)
    @company.users.pluck(:id).each do |uid|
      ActionCable.server.broadcast(
        "sales_prospect_#{uid}",
        { message: "HubSpot deal synced", type: "sales_prospect_update", item_id: sales_file.id }
      )
    end
  rescue => e
    Rails.logger.error("[HubspotWebhook][broadcast_error] #{e.message}")
  end
end

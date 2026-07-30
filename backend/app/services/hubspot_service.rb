require "net/http"
require "uri"
require "json"
require "cgi"
require "digest"
require "openssl"
require "base64"

class HubspotService
  BASE_URL  = "https://api.hubapi.com".freeze
  AUTH_URL  = "https://app.hubspot.com/oauth/authorize".freeze
  TOKEN_URL = "https://api.hubapi.com/oauth/v1/token".freeze

  # Scopes required for deal sync + custom property management
  SCOPES = "crm.objects.deals.read crm.objects.deals.write " \
           "crm.objects.contacts.read crm.objects.companies.read " \
           "crm.schemas.deals.write crm.objects.owners.read".freeze

  # HubSpot deal properties fetched on every read
  DEAL_PROPERTIES = %w[
    dealname dealstage amount closedate pipeline
    hs_deal_source
    hubspot_owner_id
    underwriter_form_sent_at
    industry_factor
    notes_last_updated
    hs_lastmodifieddate createdate
  ].freeze

  # Contact + company properties fetched when creating/updating associations
  CONTACT_PROPERTIES = %w[firstname lastname email phone].freeze
  COMPANY_PROPERTIES = %w[name address city state zip].freeze

  # Default EPHY field → HubSpot property mapping.
  # Companies can override via hs_deal_field_mapping on company_infos.
  DEFAULT_FIELD_MAPPING = {
    "deal_stage"           => "dealstage",
    "deal_size"            => "amount",
    "deal_closed_date"     => "closedate",
    "broker_comp_producer" => "hs_deal_source"
  }.freeze

  # ── Static OAuth helpers ──────────────────────────────────────────────────

  def self.client_id     = ENV["HUBSPOT_CLIENT_ID"]
  def self.client_secret = ENV["HUBSPOT_CLIENT_SECRET"]
  def self.redirect_uri  = ENV["HUBSPOT_REDIRECT_URI"]

  def self.auth_url(state:)
    params = {
      client_id:     client_id,
      redirect_uri:  redirect_uri,
      scope:         SCOPES,
      state:         state
    }
    "#{AUTH_URL}?#{URI.encode_www_form(params)}"
  end

  def self.exchange_code(code)
    post_token(
      grant_type:   "authorization_code",
      code:         code,
      redirect_uri: redirect_uri
    )
  end

  def self.refresh(refresh_token_value)
    post_token(
      grant_type:    "refresh_token",
      refresh_token: refresh_token_value
    )
  end

  def self.post_token(extra_params)
    uri = URI(TOKEN_URL)
    req = Net::HTTP::Post.new(uri)
    req["Content-Type"] = "application/x-www-form-urlencoded"
    req.body = URI.encode_www_form(
      { client_id: client_id, client_secret: client_secret }.merge(extra_params)
    )
    http         = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    JSON.parse(http.request(req).body)
  end
  private_class_method :post_token

  # ── Instance ─────────────────────────────────────────────────────────────

  def initialize(company)
    @company = company
  end

  def connected?
    @company.hs_access_token.present?
  end

  # Refreshes access token if within 5 minutes of expiry (same pattern as SalesforceService)
  def ensure_fresh_token!
    return unless @company.hs_token_expires_at &&
                  Time.now >= @company.hs_token_expires_at - 5.minutes

    tokens = HubspotService.refresh(@company.hs_refresh_token)
    raise "HubSpot token refresh failed: #{tokens['message']}" if tokens["status"] == "error"

    @company.update!(
      hs_access_token:     tokens["access_token"],
      hs_token_expires_at: Time.now + (tokens["expires_in"] || 21600).to_i.seconds
    )
  end

  # ── Deal CRUD ─────────────────────────────────────────────────────────────

  def fetch_deal(hs_deal_id)
    props = (DEAL_PROPERTIES + mapped_hs_properties).uniq.join(",")
    get("/crm/v3/objects/deals/#{hs_deal_id}?properties=#{CGI.escape(props)}&associations=contacts,companies")
  end

  def create_deal(properties)
    post("/crm/v3/objects/deals", { properties: properties })
  end

  def update_deal(hs_deal_id, properties)
    patch("/crm/v3/objects/deals/#{hs_deal_id}", { properties: properties })
  end

  def fetch_contact(contact_id)
    props = CONTACT_PROPERTIES.join(",")
    get("/crm/v3/objects/contacts/#{contact_id}?properties=#{props}")
  end

  def fetch_company(company_id)
    props = COMPANY_PROPERTIES.join(",")
    get("/crm/v3/objects/companies/#{company_id}?properties=#{props}")
  end

  def fetch_deal_associations(hs_deal_id, object_type)
    get("/crm/v3/objects/deals/#{hs_deal_id}/associations/#{object_type}")
  end

  def fetch_owner(owner_id)
    get("/crm/v3/owners/#{owner_id}")
  end

  # Returns the last `limit` recorded values of any deal property.
  # HubSpot returns history newest-first, so index 0 = current, index 1 = previous.
  # Each entry: { "value" => "...", "timestamp" => "...", "sourceType" => "CRM_UI", "sourceId" => nil }
  def fetch_deal_property_history(hs_deal_id, property, limit: 10)
    response = get("/crm/v3/objects/deals/#{hs_deal_id}?propertiesWithHistory=#{CGI.escape(property.to_s)}")
    history  = response.dig("propertiesWithHistory", property.to_s) || []
    history.first(limit)
  end

  def fetch_deal_closedate_history(hs_deal_id, limit: 10)
    fetch_deal_property_history(hs_deal_id, "closedate", limit: limit)
  end

  # Fetches all deals in the connected pipeline for backfill
  def list_deals(limit: 100, after: nil)
    query = "limit=#{limit}&properties=#{CGI.escape(DEAL_PROPERTIES.join(','))}"
    query += "&after=#{after}" if after.present?
    get("/crm/v3/objects/deals?#{query}")
  end

  # ── Company / Contact associations ───────────────────────────────────────

  def associate_contact(hs_deal_id, contact_id)
    put("/crm/v3/objects/deals/#{hs_deal_id}/associations/contacts/#{contact_id}/deal_to_contact")
  end

  def associate_company(hs_deal_id, company_id)
    put("/crm/v3/objects/deals/#{hs_deal_id}/associations/companies/#{company_id}/deal_to_company")
  end

  # ── Discovery ─────────────────────────────────────────────────────────────

  def list_pipelines
    get("/crm/v3/pipelines/deals")
  end

  def list_pipeline_stages(pipeline_id)
    get("/crm/v3/pipelines/deals/#{pipeline_id}/stages")
  end

  def list_deal_properties
    get("/crm/v3/properties/deals")
  end

  # Returns [{hs_field:, label:, description:}] for the field-mapping UI
  def self.deal_field_definitions
    [
      { "hs_field" => "dealname",       "label" => "Deal Name",         "description" => "Name of the HubSpot deal" },
      { "hs_field" => "amount",         "label" => "Amount",            "description" => "Monetary value of the deal" },
      { "hs_field" => "closedate",      "label" => "Close Date",        "description" => "Expected or actual close date" },
      { "hs_field" => "dealstage",      "label" => "Deal Stage",        "description" => "Current pipeline stage" },
      { "hs_field" => "hs_deal_source", "label" => "Deal Source",       "description" => "Source of the deal (broker/producer)" },
      { "hs_field" => "pipeline",       "label" => "Pipeline",          "description" => "Pipeline the deal belongs to" },
    ]
  end

  # ── Field mapping ─────────────────────────────────────────────────────────

  # Maps HubSpot deal properties → EPHY SalesFile attributes hash
  def map_hs_to_ephy(hs_properties)
    mapping = @company.hs_deal_field_mapping.presence || DEFAULT_FIELD_MAPPING
    attrs   = {}

    mapping.each do |ephy_field, hs_field|
      value = hs_properties[hs_field.to_s]
      next if value.blank?

      case ephy_field.to_s
      when "deal_size"
        attrs[:deal_size] = value.to_f.round
      when "closing_probability"
        attrs[:closing_probability] = value.to_f
      when "deal_closed_date"
        begin
          date = DateTime.parse(value.to_s)
          attrs[:deal_closed_date]  = date
          attrs[:closing_year]      = date.year.to_s
          attrs[:closing_quarter]   = "Q#{((date.month - 1) / 3) + 1}"
        rescue ArgumentError
          Rails.logger.warn("[HubspotService#map_hs_to_ephy] Could not parse closedate: #{value.inspect}")
        end
      when "broker_comp_producer"
        attrs[:broker_comp_producer] = value.to_s
      end
    end

    attrs
  end

  # Maps EPHY SalesFile + optional UnderwriterSubmission → HubSpot properties hash.
  # Pass only_fields: ["deal_closed_date", "deal_stage"] to send only those fields (used for
  # partial updates so EPHY never overwrites fields that HubSpot changed).
  # nil means send all fields (used when creating a new deal or doing a full push).
  def map_ephy_to_hs(sales_file, underwriter_sub = nil, only_fields: nil)
    include_field = ->(ephy_field) { only_fields.nil? || only_fields.include?(ephy_field.to_s) }
    props = {}

    props["dealstage"]      = hs_stage_for_ephy_stage(sales_file.deal_stage) if include_field.("deal_stage") && sales_file.deal_stage.present?
    props["amount"]         = sales_file.deal_size.to_s                       if include_field.("deal_size") && sales_file.deal_size.present?
    props["closedate"]      = sales_file.deal_closed_date.utc.iso8601(3)                    if include_field.("deal_closed_date") && sales_file.deal_closed_date.present?
    props["hs_deal_source"] = sales_file.broker_comp_producer                 if include_field.("broker_comp_producer") && sales_file.broker_comp_producer.present?

    if underwriter_sub
      props["medical_renewal_month"]    = underwriter_sub.medical_renewal_month.to_s if underwriter_sub.respond_to?(:medical_renewal_month) && underwriter_sub.medical_renewal_month.present?
      props["medical_rate_decision"] = underwriter_sub.rate_bucket.to_s if underwriter_sub.rate_bucket.present?
      props["prs"]                   = underwriter_sub.prs.to_s if underwriter_sub.respond_to?(:prs) && underwriter_sub.prs.present?
      props["industry_factor"]       = underwriter_sub.industry_factor.to_s if underwriter_sub.industry_factor.present?
      props["broker_comp"]           = underwriter_sub.broker_comp.to_s if underwriter_sub.broker_comp.present?
      props["subscribers"]           = underwriter_sub.subscribers.to_s if underwriter_sub.subscribers.present?
      props["members"]               = underwriter_sub.members.to_s if underwriter_sub.members.present?
      props["acs"]                   = underwriter_sub.acs.to_s if underwriter_sub.acs.present?
      props["agg_score"]             = underwriter_sub.agg_score.to_s if underwriter_sub.agg_score.present?
      props["demo"]                  = underwriter_sub.demo.to_s if underwriter_sub.demo.present?
      props["dtq_notes"]             = underwriter_sub.dtq_notes.to_s if underwriter_sub.dtq_notes.present?
      props["medical_rate_request"]  = underwriter_sub.medical_rate_request.to_s if underwriter_sub.medical_rate_request.present?
    end

    props.compact
  end

  # ── Stage mapping ─────────────────────────────────────────────────────────

  # Returns the EPHY stage key for a given HubSpot stage ID, using the per-tenant mapping
  def ephy_stage_for_hs_stage(hs_stage_id)
    return nil if hs_stage_id.blank?
    mapping = @company.hs_stage_mapping || {}
    mapping.find { |_ephy_key, hs_id| hs_id.to_s == hs_stage_id.to_s }&.first
  end

  # Returns the HubSpot stage ID for a given EPHY stage key.
  # Tries exact match first, then case-insensitive fallback.
  def hs_stage_for_ephy_stage(ephy_stage_key)
    return nil if ephy_stage_key.blank?
    mapping = @company.hs_stage_mapping || {}
    mapping[ephy_stage_key.to_s] ||
      mapping.find { |k, _v| k.to_s.downcase == ephy_stage_key.to_s.downcase }&.last
  end

  # ── Loop guard ────────────────────────────────────────────────────────────

  # Stamps SalesFile to prevent the inbound webhook from echoing EPHY's own write
  def tag_ephy_write!(sales_file)
    sales_file.update_column(:hs_written_at, Time.current)
  end

  # ── Custom property provisioning ─────────────────────────────────────────

  # Properties EPHY needs on HubSpot deal records.
  # Called once after OAuth connect — idempotent (409 = already exists, ignored).
  EPHY_CUSTOM_PROPERTIES = [
    {
      name:       "ephy_deal_id",
      label:      "EPHY Deal ID",
      type:       "string",
      fieldType:  "text",
      groupName:  "dealinformation",
      description: "Internal EPHY deal record ID — written by the EPHY integration."
    },
    {
      name:       "ephy_deal_url",
      label:      "EPHY Deal URL",
      type:       "string",
      fieldType:  "text",
      groupName:  "dealinformation",
      description: "Deep-link to this deal in the EPHY platform."
    },
    {
      name:       "underwriter_form_sent_at",
      label:      "Underwriter Form Sent At",
      type:       "datetime",
      fieldType:  "date",
      groupName:  "dealinformation",
      description: "Timestamp when the salesperson sent the underwriter form. Triggers census template send in EPHY."
    },
    {
      name:       "medical_renewal_month",
      label:      "Medical Renewal Month",
      type:       "string",
      fieldType:  "text",
      groupName:  "dealinformation",
      description: "Medical renewal month — populated by EPHY from the underwriter submission."
    },
    {
      name:       "medical_rate_decision",
      label:      "Medical Rate Decision",
      type:       "string",
      fieldType:  "text",
      groupName:  "dealinformation",
      description: "Rate bucket / medical rate decision — populated by EPHY from the underwriter submission."
    },
    {
      name:       "prs",
      label:      "PRS",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "PRS — populated by EPHY from the underwriter submission."
    },
    {
      name:       "subscribers",
      label:      "Subscribers",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "Number of subscribers — populated by EPHY from the underwriter submission."
    },
    {
      name:       "members",
      label:      "Members",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "Number of members — populated by EPHY from the underwriter submission."
    },
    {
      name:       "acs",
      label:      "ACS",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "ACS — populated by EPHY from the underwriter submission."
    },
    {
      name:       "agg_score",
      label:      "Agg Score",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "Aggregate score — populated by EPHY from the underwriter submission."
    },
    {
      name:       "industry_factor",
      label:      "Industry Factor",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "Industry factor — populated by EPHY from the underwriter submission."
    },
    {
      name:       "broker_comp",
      label:      "Broker Comp",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "Broker compensation — populated by EPHY from the underwriter submission."
    },
    {
      name:       "demo",
      label:      "Demo",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "Demo factor — populated by EPHY from the underwriter submission."
    },
    {
      name:       "dtq_notes",
      label:      "DTQ Notes",
      type:       "string",
      fieldType:  "textarea",
      groupName:  "dealinformation",
      description: "DTQ notes — populated by EPHY from the underwriter submission."
    },
    {
      name:       "medical_rate_request",
      label:      "Medical Rate Request",
      type:       "number",
      fieldType:  "number",
      groupName:  "dealinformation",
      description: "Medical rate request — populated by EPHY from the underwriter submission."
    }
  ].freeze

  # Creates EPHY's custom deal properties in the connected HubSpot portal.
  # Safe to call multiple times — 409 (already exists) is silently ignored.
  def ensure_custom_properties!
    results = { created: [], already_existed: [], failed: [] }

    EPHY_CUSTOM_PROPERTIES.each do |prop|
      body = {
        name:        prop[:name],
        label:       prop[:label],
        type:        prop[:type],
        fieldType:   prop[:fieldType],
        groupName:   prop[:groupName],
        description: prop[:description]
      }

      response = post_raw("/crm/v3/properties/deals", body)

      case response.code.to_i
      when 200, 201
        results[:created] << prop[:name]
      when 409
        results[:already_existed] << prop[:name]
      else
        results[:failed] << { name: prop[:name], code: response.code, body: response.body.to_s[0, 200] }
        Rails.logger.error("[HubspotService#ensure_custom_properties!] Failed to create property '#{prop[:name]}': HTTP #{response.code} — #{response.body.to_s[0, 200]}")
      end
    rescue => e
      results[:failed] << { name: prop[:name], error: e.message }
      Rails.logger.error("[HubspotService#ensure_custom_properties!] Exception for '#{prop[:name]}': #{e.message}")
    end

    Rails.logger.info("[HubspotService#ensure_custom_properties!] created=#{results[:created]} existed=#{results[:already_existed]} failed=#{results[:failed].map { |f| f[:name] }}")
    results
  end

  # ── Webhook signature verification ───────────────────────────────────────

  # Verifies the X-HubSpot-Signature-v3 header.
  # HubSpot v3: HMAC-SHA256(client_secret, method + url + body + timestamp), base64-encoded.
  # Returns true/false.
  def self.valid_webhook_signature?(request)
    signature = request.headers["X-HubSpot-Signature-v3"].to_s
    timestamp = request.headers["X-HubSpot-Request-Timestamp"].to_s

    return false if signature.blank? || timestamp.blank?

    # Reject requests older than 5 minutes (replay protection)
    request_time = Time.at(timestamp.to_i / 1000.0)
    return false if (Time.current - request_time).abs > 5.minutes

    source_str = request.request_method +
                 request.url +
                 request.raw_post.to_s +
                 timestamp

    expected = Base64.strict_encode64(
      OpenSSL::HMAC.digest("SHA256", ENV["HUBSPOT_CLIENT_SECRET"].to_s, source_str)
    )

    ActiveSupport::SecurityUtils.secure_compare(expected, signature)
  end

  private

  def access_token
    @company.hs_access_token
  end

  def headers
    {
      "Authorization" => "Bearer #{access_token}",
      "Content-Type"  => "application/json"
    }
  end

  def get(path)
    ensure_fresh_token!
    uri  = URI("#{BASE_URL}#{path}")
    req  = Net::HTTP::Get.new(uri, headers)
    response = perform_request(uri, req)
    JSON.parse(response.body)
  end

  def post(path, body)
    ensure_fresh_token!
    uri  = URI("#{BASE_URL}#{path}")
    req  = Net::HTTP::Post.new(uri, headers)
    req.body = body.to_json
    response = perform_request(uri, req)
    JSON.parse(response.body)
  end

  # Like post but returns the raw Net::HTTP::Response (caller checks response.code).
  # Used by ensure_custom_properties! so 409 can be handled gracefully.
  def post_raw(path, body)
    ensure_fresh_token!
    uri  = URI("#{BASE_URL}#{path}")
    req  = Net::HTTP::Post.new(uri, headers)
    req.body = body.to_json
    http         = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.request(req)
  end

  def patch(path, body)
    ensure_fresh_token!
    uri  = URI("#{BASE_URL}#{path}")
    req  = Net::HTTP::Patch.new(uri, headers)
    req.body = body.to_json
    response = perform_request(uri, req)
    parsed = JSON.parse(response.body)
    unless response.code.to_i.between?(200, 299)
      raise "HubSpot PATCH #{path} failed (HTTP #{response.code}): #{parsed['message'] || response.body.to_s[0, 200]}"
    end
    parsed
  rescue JSON::ParseError => e
    raise "HubSpot PATCH #{path} returned non-JSON (HTTP #{response&.code}): #{e.message}"
  end

  def put(path, body = nil)
    ensure_fresh_token!
    uri  = URI("#{BASE_URL}#{path}")
    req  = Net::HTTP::Put.new(uri, headers)
    req.body = body.to_json if body
    response = perform_request(uri, req)
    response.body.present? ? JSON.parse(response.body) : {}
  end

  def perform_request(uri, req, retries: 3)
    http         = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true

    retries.times do |attempt|
      response = http.request(req)
      return response unless [429, 500, 502, 503, 504].include?(response.code.to_i)

      wait =
        if response.code.to_i == 429
          # Respect Retry-After header; enforce at least 11s to clear the 10s rolling window
          retry_after = response["Retry-After"].to_i
          [retry_after, 11].max
        else
          (2 ** attempt) + rand
        end

      Rails.logger.warn("[HubspotService] HTTP #{response.code} — retrying in #{wait.round(1)}s (attempt #{attempt + 1}/#{retries})")
      sleep(wait)
    end

    http.request(req)
  end

  # Returns the list of custom HubSpot property names referenced in the company's field mapping
  def mapped_hs_properties
    (@company.hs_deal_field_mapping || {}).values.map(&:to_s)
  end
end

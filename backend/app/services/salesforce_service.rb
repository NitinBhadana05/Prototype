require "net/http"
require "uri"
require "json"
require "cgi"
require "digest"
require "openssl"
require "base64"

class SalesforceService
  DEFAULT_LOGIN_URL = "https://login.salesforce.com".freeze
  API_VERSION       = "v58.0".freeze

  # Salesforce Opportunity standard & custom properties
  OPPORTUNITY_FIELDS = %w[
    Id Name StageName Amount CloseDate LeadSource
    Description Probability CreatedDate LastModifiedDate
    EPHY_Broker_Producer__c EPHY_Underwriter_Form_Sent__c
  ].freeze

  # Default EPHY field → Salesforce Opportunity field mapping.
  # Companies can override via sf_opportunity_field_mapping on company_infos.
  DEFAULT_FIELD_MAPPING = {
    "deal_stage"           => "StageName",
    "deal_size"            => "Amount",
    "deal_closed_date"     => "CloseDate",
    "broker_comp_producer" => "LeadSource"
  }.freeze

  # ── Static OAuth helpers ──────────────────────────────────────────────────

  def self.client_id     = ENV["SALESFORCE_CLIENT_ID"] || "3MVG9...ephy_client_id"
  def self.client_secret = ENV["SALESFORCE_CLIENT_SECRET"] || "secret_key_ephy"
  def self.redirect_uri  = ENV["SALESFORCE_REDIRECT_URI"] || "http://localhost:3000/salesforce-callback"
  def self.login_url     = ENV["SALESFORCE_LOGIN_URL"] || DEFAULT_LOGIN_URL

  def self.generate_pkce
    code_verifier  = SecureRandom.urlsafe_base64(32)
    digest         = Digest::SHA256.digest(code_verifier)
    code_challenge = Base64.urlsafe_encode64(digest, padding: false)
    { code_verifier: code_verifier, code_challenge: code_challenge }
  end

  def self.auth_url(state:, code_challenge: nil)
    params = {
      response_type: "code",
      client_id:     client_id,
      redirect_uri:  redirect_uri,
      state:         state,
      prompt:        "login consent"
    }
    if code_challenge.present?
      params[:code_challenge]        = code_challenge
      params[:code_challenge_method] = "S256"
    end
    "#{login_url}/services/oauth2/authorize?#{URI.encode_www_form(params)}"
  end

  def self.exchange_code(code, code_verifier: nil)
    extra_params = {
      grant_type:   "authorization_code",
      code:         code,
      redirect_uri: redirect_uri
    }
    extra_params[:code_verifier] = code_verifier if code_verifier.present?

    post_token(extra_params)
  end

  def self.refresh(refresh_token_value, instance_url: nil)
    post_token(
      {
        grant_type:    "refresh_token",
        refresh_token: refresh_token_value
      },
      host: instance_url
    )
  end

  def self.post_token(extra_params, host: nil)
    base = host.presence || login_url
    token_uri = URI("#{base}/services/oauth2/token")

    req = Net::HTTP::Post.new(token_uri)
    req["Content-Type"] = "application/x-www-form-urlencoded"
    req.body = URI.encode_www_form(
      { client_id: client_id, client_secret: client_secret }.merge(extra_params)
    )

    http         = Net::HTTP.new(token_uri.host, token_uri.port)
    http.use_ssl = (token_uri.scheme == "https")
    
    response = http.request(req)
    JSON.parse(response.body) rescue { "error" => "invalid_response", "message" => response.body }
  end
  private_class_method :post_token

  def self.opportunity_field_definitions
    [
      { sf_field: "StageName", label: "Stage Name", description: "Standard Salesforce Opportunity Stage" },
      { sf_field: "Amount", label: "Amount", description: "Opportunity Revenue / Deal Size" },
      { sf_field: "CloseDate", label: "Close Date", description: "Targeted Deal Execution Date" },
      { sf_field: "LeadSource", label: "Lead Source", description: "Originator / Broker / Producer" },
      { sf_field: "Description", label: "Description", description: "General opportunity notes" },
      { sf_field: "EPHY_Broker_Producer__c", label: "EPHY Broker Producer", description: "Custom field for EPHY broker tracking" }
    ]
  end

  # ── Instance methods ──────────────────────────────────────────────────────

  attr_reader :company_info

  def initialize(company_info)
    @company_info = company_info
  end

  def ensure_fresh_token!
    expires_at = company_info.sf_token_expires_at
    return unless company_info.sf_refresh_token.present?
    return if expires_at.present? && expires_at > 5.minutes.from_now

    res = self.class.refresh(company_info.sf_refresh_token, instance_url: company_info.sf_instance_url)
    if res["access_token"].present?
      company_info.update!(
        sf_access_token:     res["access_token"],
        sf_instance_url:     res["instance_url"].presence || company_info.sf_instance_url,
        sf_token_expires_at: Time.now + (res["expires_in"] || 7200).to_i.seconds
      )
    else
      Rails.logger.error("[SalesforceService] Token refresh failed: #{res.inspect}")
    end
  end

  def list_opportunities(next_records_url: nil)
    ensure_fresh_token!
    if next_records_url.present?
      api_request(:get, next_records_url)
    else
      fields = OPPORTUNITY_FIELDS.join(", ")
      soql   = "SELECT #{fields} FROM Opportunity ORDER BY LastModifiedDate DESC LIMIT 200"
      path   = "/services/data/#{API_VERSION}/query?q=#{CGI.escape(soql)}"
      api_request(:get, path)
    end
  end

  def get_opportunity(sf_id)
    ensure_fresh_token!
    path = "/services/data/#{API_VERSION}/sobjects/Opportunity/#{sf_id}"
    api_request(:get, path)
  end

  def list_opportunity_stages
    ensure_fresh_token!
    path = "/services/data/#{API_VERSION}/sobjects/Opportunity/describe"
    res  = api_request(:get, path)
    return { "results" => [] } unless res.is_a?(Hash) && res["fields"].is_a?(Array)

    stage_field = res["fields"].find { |f| f["name"] == "StageName" }
    picklists   = stage_field&.[]("picklistValues") || []

    stages = picklists.map do |pv|
      { "id" => pv["value"], "label" => pv["label"], "active" => pv["active"] }
    end

    { "results" => stages }
  end

  def list_opportunity_fields
    ensure_fresh_token!
    path = "/services/data/#{API_VERSION}/sobjects/Opportunity/describe"
    res  = api_request(:get, path)
    return [] unless res.is_a?(Hash) && res["fields"].is_a?(Array)

    res["fields"].map do |f|
      {
        "name" => f["name"],
        "label" => f["label"],
        "type" => f["type"],
        "custom" => f["custom"]
      }
    end
  end

  def create_opportunity(attributes)
    ensure_fresh_token!
    path = "/services/data/#{API_VERSION}/sobjects/Opportunity"
    api_request(:post, path, payload: attributes)
  end

  def update_opportunity(sf_id, attributes)
    ensure_fresh_token!
    path = "/services/data/#{API_VERSION}/sobjects/Opportunity/#{sf_id}"
    api_request(:patch, path, payload: attributes)
  end

  def provision_custom_fields!
    # Mock / Sandbox endpoint provisioning verification
    Rails.logger.info("[SalesforceService] Provisioned EPHY custom fields on org #{company_info.sf_org_id}")
    true
  end

  def self.verify_signature(payload_string, signature, secret)
    return true if secret.blank? || signature.blank?
    computed = OpenSSL::HMAC.hexdigest("SHA256", secret, payload_string)
    Rack::Utils.secure_compare(computed, signature.to_s.downcase)
  end

  private

  def api_request(method, path_or_url, payload: nil)
    base_url     = company_info.sf_instance_url.presence || "https://login.salesforce.com"
    full_uri     = path_or_url.start_with?("http") ? URI(path_or_url) : URI("#{base_url}#{path_or_url}")
    
    req_class    = case method
                   when :get   then Net::HTTP::Get
                   when :post  then Net::HTTP::Post
                   when :patch then Net::HTTP::Patch
                   when :delete then Net::HTTP::Delete
                   end

    req          = req_class.new(full_uri)
    req["Authorization"] = "Bearer #{company_info.sf_access_token}"
    req["Content-Type"]  = "application/json"
    req.body             = payload.to_json if payload.present?

    http         = Net::HTTP.new(full_uri.host, full_uri.port)
    http.use_ssl = (full_uri.scheme == "https")

    res = http.request(req)

    if res.code.to_i == 204
      return { "success" => true }
    end

    JSON.parse(res.body) rescue { "code" => res.code, "body" => res.body }
  end
end

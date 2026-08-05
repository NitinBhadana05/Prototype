require "net/http"
require "uri"
require "json"
require "cgi"
require "digest"
require "openssl"
require "base64"

class GmailService
  DEFAULT_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth".freeze
  DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token".freeze
  API_BASE_URL      = "https://gmail.googleapis.com/gmail/v1".freeze
  SCOPES            = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/userinfo.email".freeze

  # Message field definitions for UI field mapping
  MESSAGE_FIELDS = [
    { field: "Subject", label: "Email Subject / Deal Title", description: "Header Subject from email" },
    { field: "From",    label: "Sender Email",             description: "Header From (originator email)" },
    { field: "To",      label: "Recipient Email",          description: "Header To (destination email)" },
    { field: "Snippet", label: "Email Snippet",            description: "First 100 characters of email body" },
    { field: "Date",    label: "Email Timestamp",          description: "Header Date timestamp" }
  ].freeze

  DEFAULT_FIELD_MAPPING = {
    "deal_stage"           => "Snippet",
    "deal_size"            => "Subject",
    "deal_closed_date"     => "Date",
    "broker_comp_producer" => "From"
  }.freeze

  # ── Static OAuth helpers ──────────────────────────────────────────────────

  def self.client_id     = ENV["GMAIL_CLIENT_ID"] || "google_gmail_client_id_demo.apps.googleusercontent.com"
  def self.client_secret = ENV["GMAIL_CLIENT_SECRET"] || "secret_key_google_gmail_demo"
  def self.redirect_uri  = ENV["GMAIL_REDIRECT_URI"] || "http://localhost:3000/gmail-callback"

  def self.generate_pkce
    code_verifier  = SecureRandom.urlsafe_base64(32)
    digest         = Digest::SHA256.digest(code_verifier)
    code_challenge = Base64.urlsafe_encode64(digest, padding: false)
    { code_verifier: code_verifier, code_challenge: code_challenge }
  end

  def self.auth_url(state:, code_challenge: nil)
    params = {
      client_id:     client_id,
      redirect_uri:  redirect_uri,
      response_type: "code",
      scope:         SCOPES,
      access_type:   "offline",
      prompt:        "consent",
      state:         state
    }
    if code_challenge.present?
      params[:code_challenge]        = code_challenge
      params[:code_challenge_method] = "S256"
    end
    "#{DEFAULT_AUTH_URL}?#{URI.encode_www_form(params)}"
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

  def self.refresh(refresh_token_value)
    post_token(
      grant_type:    "refresh_token",
      refresh_token: refresh_token_value
    )
  end

  def self.post_token(extra_params)
    token_uri = URI(DEFAULT_TOKEN_URL)
    req = Net::HTTP::Post.new(token_uri)
    req["Content-Type"] = "application/x-www-form-urlencoded"
    req.body = URI.encode_www_form(
      { client_id: client_id, client_secret: client_secret }.merge(extra_params)
    )

    http         = Net::HTTP.new(token_uri.host, token_uri.port)
    http.use_ssl = true

    response = http.request(req)
    JSON.parse(response.body) rescue { "error" => "invalid_response", "message" => response.body }
  end
  private_class_method :post_token

  def self.message_field_definitions
    MESSAGE_FIELDS
  end

  # ── Instance methods ──────────────────────────────────────────────────────

  attr_reader :company_info

  def initialize(company_info)
    @company_info = company_info
  end

  def ensure_fresh_token!
    expires_at = company_info.gmail_token_expires_at
    return unless company_info.gmail_refresh_token.present?
    return if expires_at.present? && expires_at > 5.minutes.from_now

    res = self.class.refresh(company_info.gmail_refresh_token)
    if res["access_token"].present?
      company_info.update!(
        gmail_access_token:     res["access_token"],
        gmail_token_expires_at: Time.now + (res["expires_in"] || 3600).to_i.seconds
      )
    else
      Rails.logger.error("[GmailService] Token refresh failed: #{res.inspect}")
    end
  end

  def fetch_user_profile
    ensure_fresh_token!
    path = "/users/me/profile"
    api_request(:get, path)
  end

  def list_messages(max_results: 50, page_token: nil, q: nil)
    ensure_fresh_token!
    params = { maxResults: max_results }
    params[:pageToken] = page_token if page_token.present?
    params[:q]         = q if q.present?
    path = "/users/me/messages?#{URI.encode_www_form(params)}"
    api_request(:get, path)
  end

  def get_message(msg_id)
    ensure_fresh_token!
    path = "/users/me/messages/#{msg_id}?format=full"
    api_request(:get, path)
  end

  def list_labels
    ensure_fresh_token!
    path = "/users/me/labels"
    res  = api_request(:get, path)
    return { "results" => [] } unless res.is_a?(Hash) && res["labels"].is_a?(Array)

    labels = res["labels"].map do |lbl|
      { "id" => lbl["id"], "label" => lbl["name"], "type" => lbl["type"] }
    end

    { "results" => labels }
  end

  def send_message(to:, subject:, body_text:)
    ensure_fresh_token!
    raw_message = "To: #{to}\r\nSubject: #{subject}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n#{body_text}"
    encoded     = Base64.urlsafe_encode64(raw_message)

    path = "/users/me/messages/send"
    api_request(:post, path, payload: { raw: encoded })
  end

  def provision_custom_labels!
    ensure_fresh_token!
    # Create or verify custom EPHY label in Gmail account
    path = "/users/me/labels"
    api_request(:post, path, payload: { name: "EPHY Deals", labelListVisibility: "labelShow", messageListVisibility: "show" })
    Rails.logger.info("[GmailService] Provisioned EPHY label for account #{company_info.gmail_email}")
    true
  rescue => e
    Rails.logger.warn("[GmailService] Label provisioning note: #{e.message}")
    true
  end

  def self.verify_signature(payload_string, signature, secret)
    return true if secret.blank? || signature.blank?
    computed = OpenSSL::HMAC.hexdigest("SHA256", secret, payload_string)
    Rack::Utils.secure_compare(computed, signature.to_s.downcase)
  end

  def health_check
    ensure_fresh_token!
    start_time = Time.now
    profile    = fetch_user_profile
    latency_ms = ((Time.now - start_time) * 1000).round

    if profile.is_a?(Hash) && profile["emailAddress"].present?
      {
        status: "healthy",
        latency_ms: latency_ms,
        email_address: profile["emailAddress"],
        messages_total: profile["messagesTotal"],
        threads_total: profile["threadsTotal"],
        history_id: profile["historyId"],
        token_expires_at: company_info.gmail_token_expires_at
      }
    else
      { status: "unhealthy", latency_ms: latency_ms, error: profile }
    end
  rescue => e
    { status: "error", message: e.message }
  end

  def tag_ephy_write!(sales_file)
    sales_file.update_column(:gmail_written_at, Time.current)
  end

  private

  def api_request(method, path_or_url, payload: nil, max_retries: 3)
    full_uri = path_or_url.start_with?("http") ? URI(path_or_url) : URI("#{API_BASE_URL}#{path_or_url}")
    
    req_class = case method
                when :get    then Net::HTTP::Get
                when :post   then Net::HTTP::Post
                when :patch  then Net::HTTP::Patch
                when :delete then Net::HTTP::Delete
                end

    retries = 0
    loop do
      begin
        req                  = req_class.new(full_uri)
        req["Authorization"] = "Bearer #{company_info.gmail_access_token}"
        req["Content-Type"]  = "application/json"
        req.body             = payload.to_json if payload.present?

        http         = Net::HTTP.new(full_uri.host, full_uri.port)
        http.use_ssl = (full_uri.scheme == "https")

        res = http.request(req)

        if res.code.to_i == 429 && retries < max_retries
          retries += 1
          sleep_time = (2 ** retries) * 0.5
          Rails.logger.warn("[GmailService] Rate limit hit (429). Retrying in #{sleep_time}s...")
          sleep(sleep_time)
          next
        end

        if res.code.to_i == 204
          return { "success" => true }
        end

        return JSON.parse(res.body) rescue { "code" => res.code, "body" => res.body }
      rescue SocketError, Timeout::Error => e
        if retries < max_retries
          retries += 1
          sleep(1.0)
          next
        end
        return { "error" => "connection_failed", "message" => e.message }
      end
    end
  end
end

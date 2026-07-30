Rails.application.routes.draw do
  # HubSpot OAuth callback (no auth — redirected from HubSpot)
  get  '/api/v1/hubspot/callback',  to: 'api/v1/hubspot#callback'
  # HubSpot app-level webhook (no auth — verified by HMAC signature)
  post '/api/v1/hubspot/webhook',   to: 'api/v1/hubspot_webhooks#deal_event'

  namespace :api do
    namespace :v1 do
      resource :hubspot, only: [], controller: 'hubspot' do
        get    :auth_url
        get    :status
        delete :disconnect
        get    :pipelines
        get    :pipeline_stages
        get    :stage_mapping
        patch  :save_stage_mapping
        get    :deal_field_mapping
        patch  :save_deal_field_mapping
        post   :sync
      end
    end
  end

  require "sidekiq/web"
  mount Sidekiq::Web => "/sidekiq"
end

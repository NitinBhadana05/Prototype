Rails.application.routes.draw do
  post '/auth/login',    to: 'auth#login'
  post '/auth/register', to: 'auth#register'

  # HubSpot OAuth callback & webhook
  get  '/api/v1/hubspot/callback',  to: 'api/v1/hubspot#callback'
  post '/api/v1/hubspot/webhook',   to: 'api/v1/hubspot_webhooks#deal_event'

  # Salesforce OAuth callback & webhook
  get  '/api/v1/salesforce/callback', to: 'api/v1/salesforce#callback'
  post '/api/v1/salesforce/webhook',  to: 'api/v1/salesforce_webhooks#opportunity_event'

  namespace :api do
    namespace :v1 do
      # Unified CRM Cross-Sync endpoints
      get  '/crm/status',             to: 'crm#status'
      post '/crm/sync_all',           to: 'crm#sync_all'

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
        get    :deals
      end

      resource :salesforce, only: [], controller: 'salesforce' do
        get    :auth_url
        get    :status
        delete :disconnect
        get    :opportunity_stages
        get    :stage_mapping
        patch  :save_stage_mapping
        get    :opportunity_fields
        get    :opportunity_field_mapping
        patch  :save_opportunity_field_mapping
        post   :sync
        get    :opportunities
      end

      resources :salesforce_opportunities, only: [:index, :destroy] do
        member do
          post :import
        end
      end
    end
  end

  require "sidekiq/web"
  mount Sidekiq::Web => "/sidekiq"
end

module Api
  module V1
    class BaseController < ActionController::API
      before_action :authenticate_request!

      private

      def authenticate_request!
        token = request.headers["Authorization"]&.split(" ")&.last
        begin
          decoded = JWT.decode(token, jwt_secret, true, algorithm: "HS256")
          @current_user_id = decoded[0]["user_id"]
          @current_company_info_id = decoded[0]["company_info_id"]
        rescue JWT::DecodeError, JWT::ExpiredSignature
          render json: { error: "Unauthorized" }, status: :unauthorized
        end
      end

      def current_company_info
        @current_company_info ||= CompanyInfo.find(@current_company_info_id)
      end

      def jwt_secret
        ENV.fetch("JWT_SECRET", "prototype_jwt_secret_change_in_production")
      end

      def jwt_encode(payload)
        payload[:exp] = 24.hours.from_now.to_i
        JWT.encode(payload, jwt_secret, "HS256")
      end
    end
  end
end

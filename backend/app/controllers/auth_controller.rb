class AuthController < ActionController::API
  def login
    user = User.find_by(email: params[:email])
    if user&.valid_password?(params[:password])
      token = JWT.encode(
        { user_id: user.id, company_info_id: user.company_info_id, exp: 24.hours.from_now.to_i },
        ENV.fetch("JWT_SECRET", "prototype_jwt_secret_change_in_production"),
        "HS256"
      )
      render json: { token: token, user: { id: user.id, email: user.email, company_info_id: user.company_info_id } }
    else
      render json: { error: "Invalid email or password" }, status: :unauthorized
    end
  end

  def register
    company = CompanyInfo.create!(name: params[:company_name] || "Test Company")
    user = User.new(email: params[:email], password: params[:password], company_info: company)
    if user.save
      token = JWT.encode(
        { user_id: user.id, company_info_id: company.id, exp: 24.hours.from_now.to_i },
        ENV.fetch("JWT_SECRET", "prototype_jwt_secret_change_in_production"),
        "HS256"
      )
      render json: { token: token, user: { id: user.id, email: user.email, company_info_id: company.id } }, status: :created
    else
      render json: { errors: user.errors.full_messages }, status: :unprocessable_entity
    end
  end
end

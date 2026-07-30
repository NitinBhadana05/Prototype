# Create a demo company
company = CompanyInfo.find_or_create_by!(name: "Demo Company") do |c|
  c.enable_sales_deal = true
end

# Create a demo user (password: password123)
User.find_or_create_by!(email: "demo@example.com") do |u|
  u.password = "password123"
  u.password_confirmation = "password123"
  u.company_info = company
end

puts "Seed data created!"
puts "  Login: demo@example.com / password123"

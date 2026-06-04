# OceanCrew Backend â€” Deploy Guide

## 1. MongoDB Atlas (Free)
1. Go to https://cloud.mongodb.com
2. Create free cluster
3. Create database user (username + password)
4. Whitelist all IPs: 0.0.0.0/0
5. Copy connection string â†’ put in MONGO_URI in .env

## 2. Cloudinary (Free)
1. Go to https://cloudinary.com
2. Sign up free
3. Dashboard â†’ copy Cloud Name, API Key, API Secret â†’ put in .env

## 3. Stripe
1. Go to https://stripe.com
2. Get Secret Key from Dashboard â†’ Developers â†’ API Keys
3. Create 5 products with prices:
   - Seafarer Pro: $4/month recurring â†’ copy price ID â†’ PRICES.seafarer_pro
   - Company Starter: $49/month recurring
   - Company Professional: $149/month recurring  
   - Company Enterprise: $399/month recurring
   - CV Generation: $4.99 one-time
4. Set up webhook: Dashboard â†’ Webhooks â†’ Add endpoint
   - URL: https://your-railway-url/api/payments/webhook
   - Events: checkout.session.completed, customer.subscription.deleted
   - Copy webhook secret â†’ STRIPE_WEBHOOK_SECRET in .env

## 4. Gmail for emails
1. Google Account â†’ Security â†’ 2-Step Verification â†’ ON
2. App Passwords â†’ Generate for Mail
3. Use that 16-char password as EMAIL_PASS in .env

## 5. Deploy to Railway (Free)
1. Go to https://railway.app
2. New Project â†’ Deploy from GitHub
3. Push your backend folder to GitHub first
4. Add all .env variables in Railway dashboard
5. Railway gives you a URL â†’ that's your API URL

## 6. Deploy Frontend to Vercel
1. Go to https://vercel.com
2. Import your frontend repo
3. Add env variable: VITE_API_URL=https://your-railway-url
4. Deploy

## 7. Create first Admin user
After deploying, run this in MongoDB Atlas console:
db.users.updateOne({ email: "your@email.com" }, { $set: { role: "admin", status: "Active", verified: true } })

## API Base URL
All requests go to: https://your-railway-url/api/

## Test API
GET https://your-railway-url/api/health
â†’ { "status": "OK", "message": "OceanCrew API running" }

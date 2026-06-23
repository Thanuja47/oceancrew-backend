const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

if (content.includes('/api/payments/stripe/create-checkout')) {
  console.log('Stripe create-checkout route already exists');
  process.exit(0);
}

const stripeRoutes = `
// STRIPE CHECKOUT (full)
app.post("/api/payments/stripe/create-checkout", protect, async (req, res) => {
  if (!stripe) return res.status(503).json({ message: "Stripe not configured. Add STRIPE_SECRET_KEY to Railway." });
  try {
    const { plan, amount } = req.body;
    if (!plan || !amount) return res.status(400).json({ message: "plan and amount are required" });
    const frontendUrl = process.env.FRONTEND_URL || "https://oceancrew.vercel.app";
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: req.user.email,
      line_items: [{
        price_data: {
          currency: "usd",
          unit_amount: Math.round(amount * 100),
          product_data: { name: "OceanCrew " + plan, description: "OceanCrew " + plan + " subscription" },
        },
        quantity: 1,
      }],
      metadata: { userId: req.user._id.toString(), plan, amount: amount.toString(), userName: req.user.name },
      success_url: frontendUrl + "?payment=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: frontendUrl + "?payment=cancelled",
    });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    let event;
    try {
      if (webhookSecret && stripe) {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        event = JSON.parse(req.body.toString());
      }
    } catch (err) {
      return res.status(400).send("Webhook Error: " + err.message);
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { userId, plan, amount, userName } = session.metadata || {};
      try {
        await Payment.create({
          userId, plan, amount: parseFloat(amount), method: "card", status: "approved",
          stripeSessionId: session.id, reference: session.payment_intent,
        });
        await Notification.create({
          userId, msg: "Payment confirmed! Your " + plan + " plan is now active.",
          icon: "checkCircle", type: "payment", link: "subscription",
        });
        const user = await User.findById(userId);
        if (user && user.email) {
          const html = "<div style='font-family:Arial,sans-serif;padding:32px;'><h2>Payment Confirmed - OceanCrew</h2><p>Dear " + (userName || user.name) + ",</p><p>Your " + plan + " subscription is now active. Amount: $" + amount + "</p></div>";
          await sendEmail(user.email, "OceanCrew - Payment Confirmed", html);
        }
      } catch (err) {
        console.error("Webhook processing error:", err.message);
      }
    }
    res.json({ received: true });
  }
);

app.get("/api/payments/stripe/session/:sessionId", protect, async (req, res) => {
  if (!stripe) return res.status(503).json({ message: "Stripe not configured" });
  try {
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    const payment = await Payment.findOne({ stripeSessionId: req.params.sessionId });
    res.json({ session, payment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

`;

content = content.replace('// ── HEALTH CHECK ──', stripeRoutes + '\n// ── HEALTH CHECK ──');
fs.writeFileSync('server.js', content);
console.log('Stripe routes added successfully');

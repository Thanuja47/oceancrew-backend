const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
const errorHandler = require("./middleware/error");

dotenv.config();
connectDB();

const app = express();

// â”€â”€ SECURITY â”€â”€
app.use(helmet());
app.use(cors({
  origin: [process.env.FRONTEND_URL, "http://localhost:3000"],
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: "Too many login attempts" });
app.use("/api/", limiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// â”€â”€ BODY PARSER â”€â”€
// Stripe webhook needs raw body â€” must be before express.json()
app.use("/api/payments/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// â”€â”€ ROUTES â”€â”€
app.use("/api/auth",          require("./routes/auth"));
app.use("/api/jobs",          require("./routes/jobs"));
app.use("/api/applications",  require("./routes/applications"));
app.use("/api/documents",     require("./routes/documents"));
app.use("/api/payments",      require("./routes/payments"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/users",         require("./routes/users"));
app.use("/api/admin",         require("./routes/admin"));

// â”€â”€ HEALTH CHECK â”€â”€
app.get("/api/health", (req, res) => res.json({ status: "OK", message: "OceanCrew API running" }));

// â”€â”€ ERROR HANDLER â”€â”€
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`OceanCrew API running on port ${PORT}`));

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
const { Resend } = require("resend");
const Stripe = require("stripe");
require("dotenv").config();

const app = express();

// â”€â”€ MIDDLEWARE â”€â”€
app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));

// â”€â”€ DB CONNECTION â”€â”€
const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URL;
    if (!uri) { console.error("No MONGO_URI found!"); return; }
    await mongoose.connect(uri);
    console.log("MongoDB connected");
  } catch (err) {
    console.error("MongoDB connection error:", err.message);
  }
};
connectDB();

// ── RESEND EMAIL SETUP (HTTP API - works on Railway) ──
const resend = new Resend(process.env.RESEND_API_KEY);

// ── STRIPE SETUP ──
const stripe = process.env.STRIPE_SECRET_KEY
  ? Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const sendEmail = async (to, subject, html) => {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[EMAIL FALLBACK] No RESEND_API_KEY. To: ${to} | Subject: ${subject}`);
    return true;
  }
  try {
    const { error } = await resend.emails.send({
      from: "OceanCrew <onboarding@resend.dev>",
      to,
      subject,
      html,
    });
    if (error) {
      console.error("Email send error:", error.message);
      return false;
    }
    console.log(`Email sent to ${to}`);
    return true;
  } catch (err) {
    console.error("Email send error:", err.message);
    return false;
  }
};

// ════════════════════════════════════════════════════════
// ── SCHEMAS ──
// ════════════════════════════════════════════════════════

// USER
const userSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  email:       { type: String, required: true, unique: true, lowercase: true },
  password:    { type: String, required: true, minlength: 6 },
  role:        { type: String, enum: ["seafarer", "company", "admin"], default: "seafarer" },
  phone:       { type: String },
  rank:        { type: String },
  companyName: { type: String },
  approved:    { type: Boolean, default: false },
  resetOtp:    { type: String },
  resetOtpExpiry: { type: Date },
  profilePicture: { type: String },
  rankExperienceMonths: { type: Number },
  lastVesselType: { type: String },
  cdcNumber: { type: String },
  passportNumber: { type: String },
  city: { type: String },
  address: { type: String },
  dgShippingNumber: { type: String },
  nationality: { type: String },
  companyDescription: { type: String },
  createdAt:   { type: Date, default: Date.now },
});
const User = mongoose.models.User || mongoose.model("User", userSchema);

// JOB
const jobSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  company:     { type: String, required: true },
  companyId:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  rank:        { type: String },
  salary:      { type: String },
  location:    { type: String },
  duration:    { type: String },
  description: { type: String },
  requirements:{ type: [String], default: [] },
  urgent:      { type: Boolean, default: false },
  status:      { type: String, enum: ["open", "closed", "paused"], default: "open" },
  createdAt:   { type: Date, default: Date.now },
});
const Job = mongoose.models.Job || mongoose.model("Job", jobSchema);

// APPLICATION
const appSchema = new mongoose.Schema({
  job:       { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
  seafarer:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name:      { type: String },
  email:     { type: String },
  rank:      { type: String },
  message:   { type: String },
  status:    { type: String, enum: ["Applied", "Shortlisted", "Interview", "Offer", "Hired", "Rejected"], default: "Applied" },
  createdAt: { type: Date, default: Date.now },
});
const Application = mongoose.models.Application || mongoose.model("Application", appSchema);

// CV
const cvSchema = new mongoose.Schema({
  seafarerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  fileName:   { type: String },
  fileData:   { type: String }, // Base64
  mimeType:   { type: String, default: "application/pdf" },
  uploadedAt: { type: Date, default: Date.now },
  status:     { type: String, enum: ["pending", "processing", "ready"], default: "pending" },
  adminNote:  { type: String },
});
const CV = mongoose.models.CV || mongoose.model("CV", cvSchema);

// NOTIFICATION
const notifSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  icon:      { type: String, default: "bell" },
  msg:       { type: String, required: true },
  type:      { type: String, default: "info" }, // pipeline, match, offer, badge, cv, payment
  link:      { type: String }, // tab to navigate to when clicked
  read:      { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});
const Notification = mongoose.models.Notification || mongoose.model("Notification", notifSchema);

// PAYMENT / SUBSCRIPTION
const paymentSchema = new mongoose.Schema({
  userId:            { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  plan:              { type: String },
  amount:            { type: Number },
  method:            { type: String, enum: ["bank_transfer", "card"], default: "bank_transfer" },
  status:            { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  reference:         { type: String },
  stripeSessionId:   { type: String },
  adminNote:         { type: String },
  createdAt:         { type: Date, default: Date.now },
});
const Payment = mongoose.models.Payment || mongoose.model("Payment", paymentSchema);

// â”€â”€ JWT HELPER â”€â”€
const makeToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET || "oceancrew_secret_2024", { expiresIn: "30d" });

// â”€â”€ AUTH MIDDLEWARE â”€â”€
const protect = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return res.status(401).json({ message: "Not authorized" });
  try {
    const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET || "oceancrew_secret_2024");
    req.user = await User.findById(decoded.id).select("-password");
    if (!req.user) return res.status(401).json({ message: "User not found" });
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== "admin") return res.status(403).json({ message: "Admin only" });
  next();
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ AUTH ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// REGISTER
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, role, phone, rank, companyName } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required" });
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "Email already registered" });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed, role: role || "seafarer", phone, rank, companyName });
    res.status(201).json({
      message: "Account created successfully",
      token: makeToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

// LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid email or password" });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: "Invalid email or password" });
    res.json({
      token: makeToken(user._id),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role, companyName: user.companyName }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

// GET MY PROFILE
app.get("/api/auth/me", protect, async (req, res) => {
  res.json(req.user);
});

// UPDATE MY PROFILE
app.put("/api/auth/profile", protect, async (req, res) => {
  try {
    const allowedUpdates = [
      "name", "phone", "rank", "companyName", "profilePicture", "rankExperienceMonths",
      "lastVesselType", "cdcNumber", "passportNumber", "city", "address",
      "dgShippingNumber", "nationality", "companyDescription"
    ];
    
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updates },
      { new: true, runValidators: true }
    ).select("-password");

    res.json(updatedUser);
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

// FORGOT PASSWORD â€” sends OTP
app.post("/api/auth/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "No account found with that email" });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    await User.findByIdAndUpdate(user._id, { resetOtp: otp, resetOtpExpiry: expiry });

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8faff;border-radius:16px;">
        <h2 style="color:#0284C7;margin-bottom:8px;">OceanCrew Password Reset</h2>
        <p style="color:#4a5568;margin-bottom:24px;">Your One-Time Password (OTP) to reset your password:</p>
        <div style="background:#1a2332;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
          <span style="font-size:36px;font-weight:700;color:#38BDF8;letter-spacing:8px;">${otp}</span>
        </div>
        <p style="color:#94A3B8;font-size:13px;">This OTP expires in <strong>15 minutes</strong>. Do not share it with anyone.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
        <p style="color:#CBD5E1;font-size:11px;">If you did not request this, please ignore this email.</p>
      </div>`;

    await sendEmail(email, "OceanCrew â€” Password Reset OTP", html);
    res.json({ message: "OTP sent to your email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

// VERIFY OTP + RESET PASSWORD
app.post("/api/auth/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) return res.status(400).json({ message: "All fields required" });
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.resetOtp !== otp) return res.status(400).json({ message: "Invalid OTP" });
    if (!user.resetOtpExpiry || new Date() > user.resetOtpExpiry)
      return res.status(400).json({ message: "OTP expired. Please request a new one." });

    const hashed = await bcrypt.hash(newPassword, 10);
    await User.findByIdAndUpdate(user._id, { password: hashed, resetOtp: null, resetOtpExpiry: null });
    res.json({ message: "Password reset successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error: " + err.message });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ JOBS ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET ALL OPEN JOBS
app.get("/api/jobs", async (req, res) => {
  try {
    const { rank, search } = req.query;
    let query = { status: "open" };
    if (rank && rank !== "All") query.rank = rank;
    if (search) query.$or = [{ title: new RegExp(search, "i") }, { company: new RegExp(search, "i") }];
    const jobs = await Job.find(query).sort({ createdAt: -1 }).limit(50);
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET MY POSTED JOBS (company)
app.get("/api/jobs/mine", protect, async (req, res) => {
  try {
    const jobs = await Job.find({ companyId: req.user._id }).sort({ createdAt: -1 });
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// CREATE JOB (company only)
app.post("/api/jobs", protect, async (req, res) => {
  try {
    if (req.user.role !== "company" && req.user.role !== "admin")
      return res.status(403).json({ message: "Only companies can post jobs" });
    const { title, rank, salary, location, duration, description, requirements, urgent } = req.body;
    const job = await Job.create({
      title, rank, salary, location, duration, description, requirements, urgent,
      company: req.user.companyName || req.user.name,
      companyId: req.user._id,
    });
    res.status(201).json(job);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE JOB STATUS (company)
app.put("/api/jobs/:id", protect, async (req, res) => {
  try {
    const job = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(job);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE JOB
app.delete("/api/jobs/:id", protect, async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ message: "Job deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ APPLICATIONS ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// APPLY TO JOB
app.post("/api/applications", protect, async (req, res) => {
  try {
    const { jobId, message } = req.body;
    const existing = await Application.findOne({ job: jobId, seafarer: req.user._id });
    if (existing) return res.status(400).json({ message: "Already applied to this job" });
    const application = await Application.create({
      job: jobId, seafarer: req.user._id,
      name: req.user.name, email: req.user.email, rank: req.user.rank, message
    });
    res.status(201).json(application);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET MY APPLICATIONS (seafarer)
app.get("/api/applications/my", protect, async (req, res) => {
  try {
    const apps = await Application.find({ seafarer: req.user._id }).populate("job").sort({ createdAt: -1 });
    res.json(apps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET APPLICATIONS FOR MY JOBS (company)
app.get("/api/applications/company", protect, async (req, res) => {
  try {
    const myJobs = await Job.find({ companyId: req.user._id });
    const jobIds = myJobs.map(j => j._id);
    const apps = await Application.find({ job: { $in: jobIds } })
      .populate("job", "title salary vessel")
      .populate("seafarer", "name email rank")
      .sort({ createdAt: -1 });
    res.json(apps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE APPLICATION STATUS (company)
app.put("/api/applications/:id", protect, async (req, res) => {
  try {
    const appl = await Application.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true })
      .populate("seafarer", "_id name email");
    if (!appl) return res.status(404).json({ message: "Application not found" });

    // Create notification for seafarer
    if (appl.seafarer?._id) {
      const msgs = {
        Shortlisted: { msg: `You have been shortlisted! - ${appl.job?.title || "a job"}`, icon: "star", type: "pipeline", link: "applications" },
        Interview:   { msg: `Interview scheduled for ${appl.job?.title || "a job"}`, icon: "clock", type: "pipeline", link: "applications" },
        Offer:       { msg: `You received an offer! Review now.`, icon: "zap", type: "offer", link: "applications" },
        Hired:       { msg: `Congratulations! You have been hired.`, icon: "checkCircle", type: "pipeline", link: "applications" },
        Rejected:    { msg: `Application update for ${appl.job?.title || "a job"}`, icon: "x", type: "pipeline", link: "applications" },
      };
      const n = msgs[req.body.status];
      if (n) {
        await Notification.create({ userId: appl.seafarer._id, ...n });
      }
    }
    res.json(appl);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ NOTIFICATIONS ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET MY NOTIFICATIONS
app.get("/api/notifications", protect, async (req, res) => {
  try {
    const notifs = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(30);
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// MARK NOTIFICATION READ
app.put("/api/notifications/:id/read", protect, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ message: "Marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// MARK ALL READ
app.put("/api/notifications/read-all", protect, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id }, { read: true });
    res.json({ message: "All marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// SEND NOTIFICATION TO USER (company/admin)
app.post("/api/notifications/send", protect, async (req, res) => {
  try {
    const { userId, msg, icon, type, link } = req.body;
    const notif = await Notification.create({ userId, msg, icon: icon || "bell", type: type || "info", link });
    
    // Send email to the user
    const user = await User.findById(userId);
    if (user && user.email) {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#f8faff;border-radius:16px;">
          <h2 style="color:#0284C7;margin-bottom:8px;">New Notification from OceanCrew</h2>
          <p style="color:#4a5568;margin-bottom:24px;">You have a new message from the administration team:</p>
          <div style="background:#1a2332;border-radius:12px;padding:24px;margin-bottom:24px;color:#CBD5E1;">
            ${msg}
          </div>
          <p style="color:#94A3B8;font-size:13px;">Please log in to your dashboard to view more details.</p>
        </div>`;
      await sendEmail(user.email, "OceanCrew Notification", html);
    }
    
    res.status(201).json(notif);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ CV ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// UPLOAD CV (seafarer)
app.post("/api/cv/upload", protect, async (req, res) => {
  try {
    if (req.user.role !== "seafarer") return res.status(403).json({ message: "Seafarers only" });
    const { fileName, fileData, mimeType } = req.body;
    if (!fileData) return res.status(400).json({ message: "File data required" });

    const cv = await CV.findOneAndUpdate(
      { seafarerId: req.user._id },
      { fileName, fileData, mimeType: mimeType || "application/pdf", uploadedAt: new Date(), status: "pending" },
      { upsert: true, new: true }
    );

    // Notify admin(s)
    const admins = await User.find({ role: "admin" });
    await Promise.all(admins.map(admin =>
      Notification.create({
        userId: admin._id,
        msg: `${req.user.name} uploaded a CV for processing`,
        icon: "fileText",
        type: "cv",
        link: "cv",
      })
    ));

    res.status(201).json({ message: "CV uploaded successfully", cv: { _id: cv._id, fileName: cv.fileName, status: cv.status, uploadedAt: cv.uploadedAt } });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET MY CV STATUS (seafarer)
app.get("/api/cv/my", protect, async (req, res) => {
  try {
    const cv = await CV.findOne({ seafarerId: req.user._id }).select("-fileData");
    res.json(cv || null);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET ALL CVs (admin)
app.get("/api/cv/all", protect, adminOnly, async (req, res) => {
  try {
    const cvs = await CV.find({}).populate("seafarerId", "name email rank").select("-fileData").sort({ uploadedAt: -1 });
    res.json(cvs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DOWNLOAD CV file (admin)
app.get("/api/cv/:id/download", protect, adminOnly, async (req, res) => {
  try {
    const cv = await CV.findById(req.params.id);
    if (!cv) return res.status(404).json({ message: "CV not found" });
    const buf = Buffer.from(cv.fileData, "base64");
    res.set("Content-Type", cv.mimeType || "application/pdf");
    res.set("Content-Disposition", `attachment; filename="${cv.fileName || "cv.pdf"}"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADMIN â€” Send generated CV via email
app.post("/api/cv/:id/send-email", protect, adminOnly, async (req, res) => {
  try {
    const cv = await CV.findById(req.params.id).populate("seafarerId", "name email");
    if (!cv) return res.status(404).json({ message: "CV not found" });
    const { emailContent } = req.body;

    const html = emailContent || `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px;">
        <h2 style="color:#0284C7;">Your OceanCrew CV is Ready!</h2>
        <p>Dear ${cv.seafarerId.name},</p>
        <p>Your professional maritime CV has been prepared by the OceanCrew admin team. Please find it attached.</p>
        <p>If you have any questions, reply to this email.</p>
        <br><p style="color:#94A3B8;font-size:12px;">â€” OceanCrew Team</p>
      </div>`;

    await sendEmail(cv.seafarerId.email, "Your OceanCrew Professional CV", html);
    await CV.findByIdAndUpdate(req.params.id, { status: "ready" });

    // Notify the seafarer
    await Notification.create({
      userId: cv.seafarerId._id,
      msg: "Your professional CV has been sent to your email!",
      icon: "award",
      type: "cv",
      link: "cv",
    });

    res.json({ message: "CV email sent successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ PAYMENTS â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// SUBMIT BANK TRANSFER REQUEST
app.post("/api/payments/bank-transfer", protect, async (req, res) => {
  try {
    const { plan, amount, reference } = req.body;
    const payment = await Payment.create({
      userId: req.user._id, plan, amount, method: "bank_transfer", reference, status: "pending"
    });
    // Notify admins
    const admins = await User.find({ role: "admin" });
    await Promise.all(admins.map(admin =>
      Notification.create({
        userId: admin._id,
        msg: `Bank transfer submitted by ${req.user.name} â€” Plan: ${plan} â€” Ref: ${reference}`,
        icon: "dollarSign",
        type: "payment",
        link: "payments",
      })
    ));
    res.status(201).json({ message: "Payment request submitted. Admin will verify within 24 hours.", payment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET MY PAYMENTS
app.get("/api/payments/my", protect, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user._id }).sort({ createdAt: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADMIN â€” Get all payments
app.get("/api/payments/all", protect, adminOnly, async (req, res) => {
  try {
    const payments = await Payment.find({}).populate("userId", "name email role").sort({ createdAt: -1 });
    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ADMIN â€” Approve/reject payment
app.put("/api/payments/:id", protect, adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate("userId", "name email");
    if (!payment) return res.status(404).json({ message: "Payment not found" });

    const approved = payment.status === "approved";
    // Notify user
    await Notification.create({
      userId: payment.userId._id,
      msg: approved
        ? `Your payment for ${payment.plan} plan has been approved!`
        : `Payment for ${payment.plan} plan was not approved. Contact support.`,
      icon: approved ? "checkCircle" : "xCircle",
      type: "payment",
      link: "subscription",
    });

    // Send invoice email if approved
    if (approved) {
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f8faff;border-radius:16px;">
          <h2 style="color:#0284C7;">Payment Confirmed â€” OceanCrew</h2>
          <p>Dear ${payment.userId.name},</p>
          <p>Your payment has been verified and your subscription is now active.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;">
            <tr><td style="padding:8px;color:#64748b;">Plan</td><td style="padding:8px;font-weight:700;">${payment.plan}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Amount</td><td style="padding:8px;font-weight:700;">$${payment.amount}</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Method</td><td style="padding:8px;">Bank Transfer</td></tr>
            <tr><td style="padding:8px;color:#64748b;">Reference</td><td style="padding:8px;font-family:monospace;">${payment.reference || "N/A"}</td></tr>
          </table>
          <p style="color:#94A3B8;font-size:12px;">Thank you for choosing OceanCrew. â€” OceanCrew Team</p>
        </div>`;
      await sendEmail(payment.userId.email, "OceanCrew â€” Payment Invoice", html);
    }

    res.json(payment);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ ADMIN ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET ALL USERS
app.get("/api/admin/users", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find({}).select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE USER
app.put("/api/admin/users/:id", protect, adminOnly, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE USER
app.delete("/api/admin/users/:id", protect, adminOnly, async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET STATS
app.get("/api/admin/stats", protect, adminOnly, async (req, res) => {
  try {
    const [totalUsers, totalJobs, totalApps, seafarers, companies, pendingPayments, pendingCVs] = await Promise.all([
      User.countDocuments(),
      Job.countDocuments(),
      Application.countDocuments(),
      User.countDocuments({ role: "seafarer" }),
      User.countDocuments({ role: "company" }),
      Payment.countDocuments({ status: "pending" }),
      CV.countDocuments({ status: "pending" }),
    ]);
    res.json({ totalUsers, totalJobs, totalApps, seafarers, companies, pendingPayments, pendingCVs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ════════════════════════════════════════════════════════
// ── STRIPE PAYMENTS ──
// ════════════════════════════════════════════════════════

// Stripe price IDs map (create these in your Stripe dashboard)
// These are fallbacks — override with env vars for live mode
const STRIPE_PRICES = {
  "Seafarer Pro":     process.env.STRIPE_PRICE_SEAFARER_PRO    || "price_seafarer_pro",
  "Professional":     process.env.STRIPE_PRICE_PROFESSIONAL    || "price_professional",
  "Enterprise":       process.env.STRIPE_PRICE_ENTERPRISE      || "price_enterprise",
};

// CREATE STRIPE CHECKOUT SESSION
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
          unit_amount: Math.round(amount * 100), // cents
          product_data: {
            name: `OceanCrew — ${plan}`,
            description: `OceanCrew ${plan} subscription`,
            images: [],
          },
        },
        quantity: 1,
      }],
      metadata: {
        userId:   req.user._id.toString(),
        plan,
        amount:   amount.toString(),
        userName: req.user.name,
      },
      success_url: `${frontendUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${frontendUrl}?payment=cancelled`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    res.status(500).json({ message: err.message });
  }
});

// STRIPE WEBHOOK — auto-approves card payments
app.post("/api/payments/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      if (webhookSecret) {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
      } else {
        event = JSON.parse(req.body);
      }
    } catch (err) {
      console.error("Webhook signature error:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const { userId, plan, amount, userName } = session.metadata || {};

      try {
        // Create approved payment record
        const payment = await Payment.create({
          userId,
          plan,
          amount: parseFloat(amount),
          method: "card",
          status: "approved",
          stripeSessionId: session.id,
          reference: session.payment_intent,
        });

        // Notify user
        await Notification.create({
          userId,
          msg: `🎉 Payment confirmed! Your ${plan} plan is now active.`,
          icon: "checkCircle",
          type: "payment",
          link: "subscription",
        });

        // Send invoice email
        const user = await User.findById(userId);
        if (user?.email) {
          const html = `
            <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:32px;background:#f8faff;border-radius:16px;">
              <h2 style="color:#0284C7;">Payment Confirmed — OceanCrew ⚓</h2>
              <p>Dear ${userName || user.name},</p>
              <p>Your card payment was successful and your subscription is now <strong>active</strong>.</p>
              <table style="width:100%;border-collapse:collapse;margin:20px 0;">
                <tr><td style="padding:8px;color:#64748b;">Plan</td><td style="padding:8px;font-weight:700;">${plan}</td></tr>
                <tr><td style="padding:8px;color:#64748b;">Amount</td><td style="padding:8px;font-weight:700;">$${amount}</td></tr>
                <tr><td style="padding:8px;color:#64748b;">Method</td><td style="padding:8px;">Credit / Debit Card (Stripe)</td></tr>
                <tr><td style="padding:8px;color:#64748b;">Reference</td><td style="padding:8px;font-family:monospace;font-size:11px;">${session.payment_intent || session.id}</td></tr>
              </table>
              <p style="color:#94A3B8;font-size:12px;">Thank you for choosing OceanCrew. — OceanCrew Team</p>
            </div>`;
          await sendEmail(user.email, "OceanCrew — Payment Confirmed", html);
        }

        console.log(`Stripe payment approved: ${plan} for userId ${userId}`);
      } catch (err) {
        console.error("Webhook processing error:", err.message);
      }
    }

    res.json({ received: true });
  }
);

// GET STRIPE SESSION (for success page)
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

// ── HEALTH CHECK ──
app.get("/api/health", (req, res) => res.json({ status: "OK", message: "OceanCrew API running" }));
app.get("/", (req, res) => res.json({ status: "OK", message: "OceanCrew API" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`OceanCrew API running on port ${PORT}`));

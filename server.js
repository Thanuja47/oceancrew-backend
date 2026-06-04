const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const helmet = require("helmet");
require("dotenv").config();

const app = express();

// â”€â”€ MIDDLEWARE â”€â”€
app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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

// â”€â”€ USER SCHEMA â”€â”€
const userSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  email:       { type: String, required: true, unique: true, lowercase: true },
  password:    { type: String, required: true, minlength: 6 },
  role:        { type: String, enum: ["seafarer", "company", "admin"], default: "seafarer" },
  phone:       { type: String },
  rank:        { type: String },
  companyName: { type: String },
  approved:    { type: Boolean, default: false },
  createdAt:   { type: Date, default: Date.now },
});
const User = mongoose.models.User || mongoose.model("User", userSchema);

// â”€â”€ JOB SCHEMA â”€â”€
const jobSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  company:     { type: String, required: true },
  companyId:   { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  rank:        { type: String },
  salary:      { type: String },
  location:    { type: String },
  description: { type: String },
  requirements:{ type: [String], default: [] },
  status:      { type: String, enum: ["open", "closed"], default: "open" },
  createdAt:   { type: Date, default: Date.now },
});
const Job = mongoose.models.Job || mongoose.model("Job", jobSchema);

// â”€â”€ APPLICATION SCHEMA â”€â”€
const appSchema = new mongoose.Schema({
  job:       { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
  seafarer:  { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  name:      { type: String },
  email:     { type: String },
  rank:      { type: String },
  message:   { type: String },
  status:    { type: String, enum: ["pending", "reviewed", "accepted", "rejected"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
});
const Application = mongoose.models.Application || mongoose.model("Application", appSchema);

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
    next();
  } catch {
    res.status(401).json({ message: "Invalid token" });
  }
};

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ AUTH ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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

// GET PROFILE
app.get("/api/auth/me", protect, async (req, res) => {
  res.json(req.user);
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ JOBS ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET ALL JOBS
app.get("/api/jobs", async (req, res) => {
  try {
    const { rank, search } = req.query;
    let query = { status: "open" };
    if (rank) query.rank = rank;
    if (search) query.$or = [{ title: new RegExp(search, "i") }, { company: new RegExp(search, "i") }];
    const jobs = await Job.find(query).sort({ createdAt: -1 }).limit(50);
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
    const { title, rank, salary, location, description, requirements } = req.body;
    const job = await Job.create({
      title, rank, salary, location, description, requirements,
      company: req.user.companyName || req.user.name,
      companyId: req.user._id,
    });
    res.status(201).json(job);
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ APPLICATIONS ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

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
    const apps = await Application.find({ job: { $in: jobIds } }).sort({ createdAt: -1 });
    res.json(apps);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// UPDATE APPLICATION STATUS (company)
app.put("/api/applications/:id", protect, async (req, res) => {
  try {
    const app = await Application.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json(app);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â”€â”€ ADMIN ROUTES â”€â”€
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

// GET ALL USERS (admin)
app.get("/api/admin/users", protect, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Admin only" });
    const users = await User.find({}).select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// APPROVE/REJECT COMPANY (admin)
app.put("/api/admin/users/:id", protect, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Admin only" });
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select("-password");
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE USER (admin)
app.delete("/api/admin/users/:id", protect, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Admin only" });
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "User deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET STATS (admin)
app.get("/api/admin/stats", protect, async (req, res) => {
  try {
    if (req.user.role !== "admin") return res.status(403).json({ message: "Admin only" });
    const [totalUsers, totalJobs, totalApps, seafarers, companies] = await Promise.all([
      User.countDocuments(),
      Job.countDocuments(),
      Application.countDocuments(),
      User.countDocuments({ role: "seafarer" }),
      User.countDocuments({ role: "company" }),
    ]);
    res.json({ totalUsers, totalJobs, totalApps, seafarers, companies });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// â”€â”€ HEALTH CHECK â”€â”€
app.get("/api/health", (req, res) => res.json({ status: "OK", message: "OceanCrew API running" }));
app.get("/", (req, res) => res.json({ status: "OK", message: "OceanCrew API" }));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`OceanCrew API running on port ${PORT}`));

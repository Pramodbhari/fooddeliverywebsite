import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import cors from "cors";
import PDFDocument from "pdfkit";

const app = express();

// Middleware
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:3000',
  methods: 'GET,POST',
  allowedHeaders: 'Content-Type'
}));
app.use(express.urlencoded({ extended: true }));
app.use("/assets", express.static("assets"));

// MongoDB Connection
mongoose.connect("mongodb://localhost:27017/foodDeliveryApp")
  .then(() => console.log("✅ DB connected"))
  .catch((err) => console.log("❌ DB connection error:", err));

// Schemas
const userSchema = new mongoose.Schema({
  email: String,
  username: String,
  password: String,
});
const User = mongoose.model("users", userSchema);

const productSchema = new mongoose.Schema({
  id: Number,
  title: String,
  category: String,
  price: Number,
  description: String,
  image: String,
});
const Product = mongoose.model("products", productSchema);

const orderSchema = new mongoose.Schema({
  customerInfo: Object,
  deliveryAddress: Object,
  paymentMethod: String,
  paymentInfo: Object, // includes card or upiId
  items: Array,
  subtotal: Number,
  deliveryFee: Number,
  taxes: Number,
  total: Number,
  status: { type: String, default: "Pending" },
  placedAt: Date,
});
const Order = mongoose.model("orders", orderSchema);

// === AUTH ROUTES ===

app.post("/signup", async (req, res) => {
  const { email, username, password } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email already in use" });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ email, username, password: hashedPassword });
    await newUser.save();

    res.status(201).json({ message: "Signup successful" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user)
      return res.status(400).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Invalid credentials" });

    res.status(200).json({ message: "Login successful", token: "dummy-token" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// === ORDER ROUTES ===

app.post("/placeOrder", async (req, res) => {
  try {
    const {
      customerInfo,
      deliveryAddress,
      paymentMethod,
      paymentInfo,
      items,
      subtotal,
      deliveryFee,
      taxes,
      total,
      placedAt
    } = req.body;

    const newOrder = new Order({
      customerInfo,
      deliveryAddress,
      paymentMethod,
      paymentInfo,
      items,
      subtotal,
      deliveryFee,
      taxes,
      total,
      status: "Confirmed",
      placedAt: placedAt || new Date(),
    });

    const savedOrder = await newOrder.save();

    res.status(201).json({
      message: "Order placed successfully",
      orderId: savedOrder._id,
      total: savedOrder.total,
    });
  } catch (error) {
    console.error("❌ Error placing order:", error);
    res.status(500).json({ message: "Failed to place order" });
  }
});

// Fetch orders by email
app.get("/orders/user/:email", async (req, res) => {
  const email = req.params.email;

  try {
    const userOrders = await Order.find({ "customerInfo.email": email });
    res.status(200).json(userOrders);
  } catch (error) {
    console.error("❌ Error fetching user orders:", error);
    res.status(500).json({ message: "Failed to retrieve orders" });
  }
});

// Generate invoice
app.get("/orders/invoice/:orderId", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ message: "Order not found" });

    const doc = new PDFDocument({ margin: 50 });
    let buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename=invoice-${order._id}.pdf`);
      res.send(pdfData);
    });

    const customerName =
      order.customerInfo?.fullName || "Valued Customer";
    const invoiceDate = new Date(order.placedAt).toLocaleDateString();

    doc.rect(0, 0, doc.page.width, doc.page.height).fill("#fff7f0");
    doc.fillColor("black");

    doc.fontSize(24).text("Food Delivery Invoice", 50, 50);
    doc.fontSize(10).fillColor("#888").text(`Date: ${invoiceDate}`, 50, 80);
    doc.fontSize(10).text(`Order ID: ${order._id}`, 50, 95);

    doc.moveTo(50, 110).lineTo(550, 110).stroke("#e0a800");

    // Table Headers
    doc.fontSize(12).fillColor("#000")
      .text("Item", 50, 130)
      .text("Price", 250, 130)
      .text("Qty", 350, 130)
      .text("Total", 450, 130);

    let y = 150;
    order.items.forEach(item => {
      doc.fontSize(10).fillColor("#333")
        .text(item.title, 50, y)
        .text(`₹${item.price}`, 250, y)
        .text(`${item.quantity}`, 350, y)
        .text(`₹${item.price * item.quantity}`, 450, y);
      y += 20;
    });

    doc.moveTo(50, y + 10).lineTo(550, y + 10).stroke("#ccc");
    doc.fontSize(12).fillColor("#000")
      .text("Subtotal", 350, y + 30)
      .text(`₹${order.subtotal.toFixed(2)}`, 450, y + 30)
      .text("Delivery", 350, y + 50)
      .text(`₹${order.deliveryFee.toFixed(2)}`, 450, y + 50)
      .text("Taxes", 350, y + 70)
      .text(`₹${order.taxes.toFixed(2)}`, 450, y + 70)
      .font("Helvetica-Bold")
      .text("Total", 350, y + 90)
      .text(`₹${order.total.toFixed(2)}`, 450, y + 90);

    doc.font("Helvetica").fontSize(9).fillColor("#555").text("Thank you for ordering with us!", 50, y + 130);

    doc.end();
  } catch (error) {
    console.error("❌ Failed to generate invoice:", error);
    res.status(500).json({ message: "Error generating invoice" });
  }
});

// Start Server
app.listen(9000, () => {
  console.log("🚀 Server is running on http://localhost:9000");
});

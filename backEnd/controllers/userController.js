const User = require("../models/User");

const registerUser = async (req, res, next) => {
  try {
    const walletAddress = req.user.walletAddress;
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ success: false, message: "Supply a contact profile object." });
    }
    const { name = "", email = "", phone = "" } = req.body;
    if (Object.keys(req.body).some((key) => !["name", "email", "phone"].includes(key)) ||
        typeof name !== "string" || name.length > 100 ||
        typeof email !== "string" || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        typeof phone !== "string" || phone.length > 30 || (phone && !/^[+\d\s().-]+$/.test(phone))) {
      return res.status(400).json({ success: false, message: "Supply a name (up to 100 characters), valid email, and optional phone number only." });
    }

    await User.updateOne({ walletAddress, email: { $ne: email.trim().toLowerCase() } }, { $unset: { verifiedEmail: 1, emailVerifiedAt: 1 } });
    const user = await User.findOneAndUpdate(
      { walletAddress },
      {
        walletAddress,
        name: name || "",
        email: email || "",
        phone: phone || "",
      },
      {
        returnDocument: "after",
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    res.status(200).json({
      success: true,
      message: "User profile saved successfully",
      user: {
        walletAddress: user.walletAddress,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await User.findOne({
      walletAddress: req.user.walletAddress,
    }).select("walletAddress name email phone role emailVerifiedAt +verifiedEmail");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    res.status(200).json({
      success: true,
      user: { walletAddress: user.walletAddress, name: user.name, email: user.email, phone: user.phone, role: user.role,
        emailVerified: Boolean(user.email && user.email === user.verifiedEmail), emailVerifiedAt: user.emailVerifiedAt },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  getMe,
};

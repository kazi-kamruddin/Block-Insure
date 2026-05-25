const User = require("../models/User");

const registerUser = async (req, res, next) => {
  try {
    const walletAddress = req.user.walletAddress;
    const { name, email, phone, hashedNid } = req.body;

    const user = await User.findOneAndUpdate(
      { walletAddress },
      {
        walletAddress,
        name: name || "",
        email: email || "",
        phone: phone || "",
        hashedNid: hashedNid || "",
      },
      {
        new: true,
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
        hashedNid: user.hashedNid,
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
    }).select("-nonce");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User profile not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  getMe,
};
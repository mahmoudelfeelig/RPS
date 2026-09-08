const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const checkAndAwardBadges = require('../utils/checkAndAwardBadges');
const checkAndAwardAchievements = require('../utils/checkAndAwardAchievements');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../utils/mailer');
const generateToken = require('../utils/authToken');

const generateVerificationCode = () => String(crypto.randomInt(100000, 1000000));

const isSameDay = (d1, d2) => {
  return (
    d1.getUTCFullYear() === d2.getUTCFullYear() &&
    d1.getUTCMonth() === d2.getUTCMonth() &&
    d1.getUTCDate() === d2.getUTCDate()
  );
};

exports.register = async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ message: 'Username already taken' });
    if (!normalizedEmail) return res.status(400).json({ message: 'Email is required' });

    const existingEmail = await User.findOne({ email: normalizedEmail });
    if (existingEmail) return res.status(400).json({ message: 'Email already in use' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const verificationCode = generateVerificationCode();
    const verificationExpires = new Date(Date.now() + 30 * 60 * 1000);
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const user = await User.create({
      username,
      email: normalizedEmail,
      password: hashedPassword,
      profileImage: '/assets/avatars/default-avatar.png',
      publicProfileCreated: true,
      emailVerified: false,
      emailVerificationCode: verificationCode,
      emailVerificationExpiresAt: verificationExpires,
      emailVerificationToken: verificationToken,
    });

    const verifyBase = process.env.EMAIL_VERIFY_BASE_URL || 'http://localhost:3000/verify-email';
    const verifyUrl = `${verifyBase}?email=${encodeURIComponent(normalizedEmail)}&token=${verificationToken}`;

    await sendVerificationEmail({
      to: normalizedEmail,
      code: verificationCode,
      verifyUrl,
    });

    res.status(201).json({
      message: 'Check your email for a verification code and link.',
      email: normalizedEmail,
      userId: user._id,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Registration failed' });
  }
};

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username }).select('+password +tokenVersion');

    if (!user) return res.status(400).json({ message: 'Wrong Username' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ message: 'Incorrect password' });
    if (user.email && !user.emailVerified) {
      return res.status(403).json({
        message: 'Verify your email before signing in',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const now = new Date();
    const lastLogin = new Date(user.lastLoginDate || 0);

    if (!isSameDay(now, lastLogin)) {
      user.loginCount = (user.loginCount || 0) + 1;
      user.lastLoginDate = now;
      await user.save();
    }

    if (!user.publicProfileCreated) {
      user.publicProfileCreated = true;
      if (!user.profileImage) {
        user.profileImage = '/assets/avatars/default-avatar.png';
      }
      await user.save();
    }

    await checkAndAwardBadges(user._id);
    await checkAndAwardAchievements(user._id);

    const token = generateToken(user);

    const { password: _, tokenVersion: __, ...userData } = user.toObject();
    res.json({ token, user: userData });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed' });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const { email, code, token } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || (!code && !token)) {
      return res.status(400).json({ message: 'Email and code or token are required' });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      '+emailVerificationCode +emailVerificationToken +tokenVersion'
    );
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (user.emailVerified) {
      return res.json({ message: 'Email already verified' });
    }

    const expired =
      user.emailVerificationExpiresAt && user.emailVerificationExpiresAt.getTime() < Date.now();
    if (expired) {
      return res.status(400).json({ message: 'Verification code expired' });
    }

    const codeMatches = code && user.emailVerificationCode === String(code).trim();
    const tokenMatches = token && user.emailVerificationToken === String(token).trim();

    if (!codeMatches && !tokenMatches) {
      return res.status(400).json({ message: 'Invalid verification code or link' });
    }

    user.emailVerified = true;
    user.emailVerificationCode = null;
    user.emailVerificationToken = null;
    user.emailVerificationExpiresAt = null;
    await user.save();

    const authToken = generateToken(user);
    const { password: __, tokenVersion: ___, ...userData } = user.toObject();
    res.json({
      message: 'Email verified successfully',
      token: authToken,
      user: userData,
    });
  } catch (err) {
    console.error('verifyEmail error:', err);
    res.status(500).json({ message: 'Verification failed' });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      '+emailVerificationCode +emailVerificationToken'
    );
    if (!user) return res.status(404).json({ message: 'Account not found' });
    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    const verificationCode = generateVerificationCode();
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.emailVerificationCode = verificationCode;
    user.emailVerificationToken = verificationToken;
    user.emailVerificationExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    const verifyBase = process.env.EMAIL_VERIFY_BASE_URL || 'http://localhost:3000/verify-email';
    const verifyUrl = `${verifyBase}?email=${encodeURIComponent(normalizedEmail)}&token=${verificationToken}`;

    await sendVerificationEmail({
      to: normalizedEmail,
      code: verificationCode,
      verifyUrl,
    });

    res.json({ message: 'Verification email resent' });
  } catch (err) {
    console.error('resendVerification error:', err);
    res.status(500).json({ message: 'Could not resend verification email' });
  }
};

exports.requestPasswordReset = async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: normalizedEmail }).select(
      '+passwordResetCode +passwordResetToken'
    );
    if (!user) {
      return res.json({ message: 'If that email exists, a reset code has been sent.' });
    }

    const resetCode = generateVerificationCode();
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetCode = resetCode;
    user.passwordResetToken = resetToken;
    user.passwordResetExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await user.save();

    const resetBase =
      process.env.PASSWORD_RESET_BASE_URL ||
      `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '')}/reset-password`;
    const resetUrl = `${resetBase}?email=${encodeURIComponent(normalizedEmail)}&token=${resetToken}`;

    await sendPasswordResetEmail({
      to: normalizedEmail,
      code: resetCode,
      resetUrl,
    });

    res.json({ message: 'If that email exists, a reset code has been sent.' });
  } catch (err) {
    console.error('requestPasswordReset error:', err);
    res.status(500).json({ message: 'Could not send reset email' });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, code, token, password } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail || (!code && !token) || !password) {
      return res
        .status(400)
        .json({ message: 'Email, reset code or token, and password are required' });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const user = await User.findOne({ email: normalizedEmail }).select(
      '+password +passwordResetCode +passwordResetToken +tokenVersion'
    );
    if (!user) return res.status(400).json({ message: 'Invalid or expired reset code' });
    const expired =
      user.passwordResetExpiresAt && user.passwordResetExpiresAt.getTime() < Date.now();
    if (expired) return res.status(400).json({ message: 'Reset code expired' });

    const codeMatches = code && user.passwordResetCode === String(code).trim();
    const tokenMatches = token && user.passwordResetToken === String(token).trim();
    if (!codeMatches && !tokenMatches) {
      return res.status(400).json({ message: 'Invalid or expired reset code' });
    }

    user.password = await bcrypt.hash(password, 10);
    user.passwordResetCode = null;
    user.passwordResetToken = null;
    user.passwordResetExpiresAt = null;
    user.emailVerified = true;
    user.tokenVersion = Number(user.tokenVersion || 0) + 1;
    await user.save();

    const authToken = generateToken(user);
    const { password: _, tokenVersion: __, ...userData } = user.toObject();
    res.json({ message: 'Password reset successfully', token: authToken, user: userData });
  } catch (err) {
    console.error('resetPassword error:', err);
    res.status(500).json({ message: 'Password reset failed' });
  }
};

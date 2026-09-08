import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Edit, LogOut, UploadCloud, Eye, EyeOff, Trash2 } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../context/AuthContext';
import { API_BASE } from '../../api';
import { PageFrame, PageHero, StatCard } from '../../components/ui/page';

const fallbackAvatar = '/assets/avatars/default-avatar.png';

const getProfileImage = (user) => {
  if (!user?.profileImage) return fallbackAvatar;
  return user.profileImage.startsWith('http')
    ? user.profileImage
    : `${API_BASE}${user.profileImage}`;
};

export default function Profile() {
  const { user, token, login, logout } = useAuth();
  const [showEditFields, setShowEditFields] = useState(false);
  const [username, setUsername] = useState(user?.username || '');
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [image, setImage] = useState(getProfileImage(user));
  const [imageFile, setImageFile] = useState(null);
  const [profileImageUrl, setProfileImageUrl] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const previewRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    setUsername(user?.username || '');
    if (!imageFile && !profileImageUrl) {
      setImage(getProfileImage(user));
    }
  }, [user, imageFile, profileImageUrl]);

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
      }
    };
  }, []);

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
    }
    previewRef.current = URL.createObjectURL(file);
    setImage(previewRef.current);
    setImageFile(file);
    setProfileImageUrl('');
  };

  const getPasswordStrength = (value) => {
    if (!value) return '';
    if (
      value.length >= 12 &&
      /[A-Z]/.test(value) &&
      /\d/.test(value) &&
      /[^A-Za-z0-9]/.test(value)
    ) {
      return 'strong';
    }
    if (value.length >= 8) return 'medium';
    return 'weak';
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const formData = new FormData();
      if (username !== user.username) formData.append('username', username);
      if (password) {
        formData.append('password', password);
        formData.append('currentPassword', currentPassword);
      }
      if (profileImageUrl) formData.append('profileImageUrl', profileImageUrl.trim());
      if (imageFile) formData.append('image', imageFile);

      const res = await fetch(`${API_BASE}/api/user/update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Update failed');
      }

      login({ token: data.token || token, user: data.user });
      toast.success('Profile updated');
      setPassword('');
      setCurrentPassword('');
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current);
        previewRef.current = null;
      }
      setImageFile(null);
      setProfileImageUrl('');
      setShowEditFields(false);
    } catch (err) {
      toast.error(err.message || 'Connection error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteAccount = async (e) => {
    e.preventDefault();
    if (deleteConfirm !== user?.username) {
      return toast.error('Type your username to confirm deletion');
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/delete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Account deletion failed');
      toast.success('Account deleted');
      logout();
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.message || 'Account deletion failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <PageFrame className="bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_30%),linear-gradient(180deg,#050816_0%,#09090b_55%,#020202_100%)]">
      <AnimatePresence>
        {isLoading && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-blue-400" />
              <span className="text-white/70">Saving changes...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="mx-auto max-w-4xl space-y-6"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <PageHero
          title="Account settings"
          description="Manage your username, password, profile image, and account access from one place."
          actions={
            <>
              <StatCard
                label="Balance"
                value={`${(user?.balance ?? 0).toLocaleString()} coins`}
                tone="text-emerald-100"
              />
              <StatCard label="Role" value={user?.role || 'user'} tone="text-cyan-100" />
            </>
          }
        />

        <section className="rounded-[32px] border border-white/10 bg-white/[0.06] p-6 shadow-2xl backdrop-blur-2xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="h-20 w-20 overflow-hidden rounded-[28px] border border-white/10 bg-white/10">
                <img
                  src={getProfileImage(user)}
                  alt="Profile"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = fallbackAvatar;
                  }}
                />
              </div>
              <div>
                <Link
                  to={`/profile/${user?.username}`}
                  className="text-lg font-semibold text-white hover:underline"
                >
                  @{user.username}
                </Link>
                <p className="mt-1 text-sm text-white/55">
                  {user?.role || 'user'} · {(user?.balance ?? 0).toLocaleString()} coins
                </p>
              </div>
            </div>
            <Button
              onClick={logout}
              disabled={isLoading}
              className="border border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
            >
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </Button>
          </div>
        </section>

        <section className="rounded-[32px] border border-white/10 bg-white/[0.05] p-6 shadow-xl backdrop-blur-xl">
          <Button
            onClick={() => setShowEditFields(!showEditFields)}
            disabled={isLoading}
            className="w-full justify-center bg-blue-600 text-white hover:bg-blue-500"
          >
            <Edit className="mr-2 h-4 w-4" />
            {showEditFields ? 'Close edit' : 'Edit'}
          </Button>

          {showEditFields && (
            <div className="mt-6 space-y-4">
              <label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="h-16 w-16 overflow-hidden rounded-2xl border border-white/20 bg-white/10">
                  {image ? (
                    <img src={image} alt="Preview" className="h-full w-full object-cover" />
                  ) : (
                    <UploadCloud className="h-full w-full p-3 text-white/45" />
                  )}
                </div>
                <div>
                  <div className="font-medium text-white">Upload profile image or GIF</div>
                  <div className="text-sm text-white/50">Choose a local file from your device.</div>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageChange}
                />
              </label>

              <input
                type="url"
                value={profileImageUrl}
                onChange={(e) => {
                  const next = e.target.value;
                  setProfileImageUrl(next);
                  if (next) {
                    setImage(next);
                    setImageFile(null);
                  } else if (!imageFile) {
                    setImage(getProfileImage(user));
                  }
                }}
                placeholder="Or paste an image/GIF URL"
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-white outline-none transition focus:border-blue-400"
              />

              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-white outline-none transition focus:border-blue-400"
              />

              <div className="relative">
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  autoComplete="current-password"
                  className="mb-3 w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-white outline-none transition focus:border-blue-400"
                />
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPassword(val);
                    setPasswordStrength(getPasswordStrength(val));
                  }}
                  placeholder="New password"
                  autoComplete="new-password"
                  className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 pr-12 text-white outline-none transition focus:border-blue-400"
                />
                <button
                  type="button"
                  className="absolute right-3 top-3 text-white/50 transition hover:text-white"
                  onClick={() => setPasswordVisible(!passwordVisible)}
                >
                  {passwordVisible ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>

              {password && (
                <p
                  className={`text-sm font-medium ${passwordStrength === 'strong' ? 'text-green-400' : passwordStrength === 'medium' ? 'text-yellow-400' : 'text-red-400'}`}
                >
                  Password strength: {passwordStrength}
                </p>
              )}

              <Button
                onClick={handleSave}
                disabled={isLoading}
                className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
              >
                Save changes
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-red-400/20 bg-red-500/10 p-5 text-sm text-red-100">
          <div className="flex items-start gap-3">
            <Trash2 className="mt-0.5 h-4 w-4" />
            <div>
              <div className="font-semibold">Account deletion</div>
              <p className="mt-1 text-red-100/70">
                Delete your account permanently. This cannot be undone.
              </p>
            </div>
          </div>
          <form onSubmit={handleDeleteAccount} className="mt-4 grid gap-3">
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Current password"
              className="rounded-2xl border border-red-300/20 bg-black/25 px-4 py-3 text-white outline-none focus:border-red-300"
            />
            <input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder={`Type ${user?.username || 'your username'} to confirm`}
              className="rounded-2xl border border-red-300/20 bg-black/25 px-4 py-3 text-white outline-none focus:border-red-300"
            />
            <Button
              type="submit"
              disabled={isLoading || !deletePassword || deleteConfirm !== user?.username}
              className="border border-red-300/30 bg-red-500/20 text-red-50 hover:bg-red-500/30 disabled:opacity-50"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete account
            </Button>
          </form>
        </section>
      </motion.div>
    </PageFrame>
  );
}

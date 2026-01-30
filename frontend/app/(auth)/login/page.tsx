'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';

interface AttendanceInfo {
  isNewRecord: boolean;
  status: 'on_time' | 'late' | 'half_day';
  message: string;
  minutesLate?: number;
}

// Yeti Avatar Component
function YetiAvatar({ 
  isPasswordFocused, 
  emailLength,
  isLoading 
}: { 
  isPasswordFocused: boolean;
  emailLength: number;
  isLoading: boolean;
}) {
  // Map email length to eye position (-12 to 12)
  const eyeX = Math.min(Math.max((emailLength - 10) * 0.8, -12), 12);
  const eyeY = isPasswordFocused ? 0 : 2;
  
  // Animation variants for hands (peekaboo effect)
  const handVariants = {
    hidden: { y: 80, opacity: 0 },
    visible: { 
      y: 0, 
      opacity: 1,
      transition: { 
        type: 'spring' as const, 
        stiffness: 300, 
        damping: 20 
      }
    }
  };

  // Eye variants
  const eyeVariants = {
    open: { scaleY: 1 },
    closed: { 
      scaleY: 0.1,
      transition: { duration: 0.15 }
    }
  };

  return (
    <svg
      viewBox="0 0 200 200"
      className="w-40 h-40"
      style={{ overflow: 'visible' }}
    >
      {/* Definitions for gradients */}
      <defs>
        <linearGradient id="yetiBody" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#8B9DC3" />
          <stop offset="100%" stopColor="#6B7AA1" />
        </linearGradient>
        <linearGradient id="yetiShadow" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#7A8BB3" />
          <stop offset="100%" stopColor="#5A6A91" />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodOpacity="0.2" />
        </filter>
      </defs>

      {/* Main Head */}
      <motion.ellipse
        cx="100"
        cy="100"
        rx="70"
        ry="65"
        fill="url(#yetiBody)"
        filter="url(#shadow)"
        animate={{ scale: isLoading ? [1, 1.02, 1] : 1 }}
        transition={{ duration: 0.5, repeat: isLoading ? Infinity : 0 }}
      />

      {/* Ears */}
      <circle cx="40" cy="65" r="20" fill="url(#yetiBody)" />
      <circle cx="40" cy="65" r="12" fill="#B8C5E2" />
      <circle cx="160" cy="65" r="20" fill="url(#yetiBody)" />
      <circle cx="160" cy="65" r="12" fill="#B8C5E2" />

      {/* Inner face / muzzle area */}
      <ellipse cx="100" cy="115" rx="45" ry="35" fill="#B8C5E2" />

      {/* Eye whites */}
      <motion.g
        variants={eyeVariants}
        animate={isPasswordFocused ? 'closed' : 'open'}
        style={{ transformOrigin: '100px 85px' }}
      >
        <ellipse cx="70" cy="85" rx="22" ry="24" fill="white" />
        <ellipse cx="130" cy="85" rx="22" ry="24" fill="white" />
        
        {/* Pupils - follow input */}
        <motion.circle
          cx={70 + eyeX}
          cy={85 + eyeY}
          r="10"
          fill="#2D3748"
          animate={{ cx: 70 + eyeX, cy: 85 + eyeY }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        />
        <motion.circle
          cx={130 + eyeX}
          cy={85 + eyeY}
          r="10"
          fill="#2D3748"
          animate={{ cx: 130 + eyeX, cy: 85 + eyeY }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        />
        
        {/* Eye highlights */}
        <circle cx={67 + eyeX * 0.5} cy={80 + eyeY * 0.5} r="4" fill="white" opacity="0.8" />
        <circle cx={127 + eyeX * 0.5} cy={80 + eyeY * 0.5} r="4" fill="white" opacity="0.8" />
      </motion.g>

      {/* Eyebrows */}
      <motion.path
        d="M 48 65 Q 70 55, 92 65"
        stroke="#5A6A91"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        animate={{ 
          d: isPasswordFocused 
            ? "M 48 70 Q 70 65, 92 70"
            : "M 48 65 Q 70 55, 92 65"
        }}
      />
      <motion.path
        d="M 108 65 Q 130 55, 152 65"
        stroke="#5A6A91"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
        animate={{ 
          d: isPasswordFocused 
            ? "M 108 70 Q 130 65, 152 70"
            : "M 108 65 Q 130 55, 152 65"
        }}
      />

      {/* Nose */}
      <ellipse cx="100" cy="110" rx="12" ry="8" fill="#6B7AA1" />
      <ellipse cx="97" cy="108" rx="3" ry="2" fill="#8B9DC3" opacity="0.6" />

      {/* Mouth */}
      <motion.path
        d="M 85 130 Q 100 140, 115 130"
        stroke="#5A6A91"
        strokeWidth="3"
        strokeLinecap="round"
        fill="none"
        animate={{
          d: isPasswordFocused 
            ? "M 90 130 Q 100 132, 110 130"
            : "M 85 130 Q 100 145, 115 130"
        }}
        transition={{ duration: 0.2 }}
      />

      {/* Hands (peekaboo animation) */}
      <AnimatePresence>
        {isPasswordFocused && (
          <>
            {/* Left Hand */}
            <motion.g
              variants={handVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
            >
              <ellipse cx="55" cy="85" rx="30" ry="25" fill="url(#yetiShadow)" />
              {/* Fingers */}
              <ellipse cx="35" cy="70" rx="10" ry="12" fill="url(#yetiShadow)" />
              <ellipse cx="45" cy="62" rx="9" ry="11" fill="url(#yetiShadow)" />
              <ellipse cx="58" cy="60" rx="9" ry="11" fill="url(#yetiShadow)" />
              <ellipse cx="70" cy="64" rx="8" ry="10" fill="url(#yetiShadow)" />
              {/* Palm pad */}
              <ellipse cx="55" cy="90" rx="15" ry="12" fill="#A8B5D5" />
            </motion.g>

            {/* Right Hand */}
            <motion.g
              variants={handVariants}
              initial="hidden"
              animate="visible"
              exit="hidden"
            >
              <ellipse cx="145" cy="85" rx="30" ry="25" fill="url(#yetiShadow)" />
              {/* Fingers */}
              <ellipse cx="165" cy="70" rx="10" ry="12" fill="url(#yetiShadow)" />
              <ellipse cx="155" cy="62" rx="9" ry="11" fill="url(#yetiShadow)" />
              <ellipse cx="142" cy="60" rx="9" ry="11" fill="url(#yetiShadow)" />
              <ellipse cx="130" cy="64" rx="8" ry="10" fill="url(#yetiShadow)" />
              {/* Palm pad */}
              <ellipse cx="145" cy="90" rx="15" ry="12" fill="#A8B5D5" />
            </motion.g>
          </>
        )}
      </AnimatePresence>
    </svg>
  );
}

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attendance, setAttendance] = useState<AttendanceInfo | null>(null);
  const [isPasswordFocused, setIsPasswordFocused] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setAttendance(null);
    setLoading(true);

    try {
      const result = await login(username, password);
      
      if (result?.attendance?.isNewRecord) {
        setAttendance(result.attendance);
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const getAttendanceStyles = (status: string) => {
    switch (status) {
      case 'on_time':
        return 'bg-emerald-50 border-emerald-200 text-emerald-800';
      case 'late':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      case 'half_day':
        return 'bg-orange-50 border-orange-200 text-orange-800';
      default:
        return 'bg-gray-50 border-gray-200 text-gray-800';
    }
  };

  const getAttendanceIcon = (status: string) => {
    switch (status) {
      case 'on_time':
        return <CheckCircle className="h-5 w-5 text-emerald-600" />;
      case 'late':
        return <Clock className="h-5 w-5 text-amber-600" />;
      case 'half_day':
        return <AlertCircle className="h-5 w-5 text-orange-600" />;
      default:
        return <Clock className="h-5 w-5" />;
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 p-4">
      {/* Animated background shapes */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute -top-40 -right-40 w-80 h-80 bg-purple-200 rounded-full opacity-30 blur-3xl"
          animate={{ 
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0]
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        />
        <motion.div
          className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-200 rounded-full opacity-30 blur-3xl"
          animate={{ 
            scale: [1.2, 1, 1.2],
            rotate: [0, -90, 0]
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        />
      </div>

      <div className="w-full max-w-md relative">
        {/* Yeti Avatar - positioned above card */}
        <motion.div 
          className="flex justify-center mb-[-40px] relative z-10"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.2 }}
        >
          <YetiAvatar 
            isPasswordFocused={isPasswordFocused}
            emailLength={username.length}
            isLoading={loading}
          />
        </motion.div>

        {/* Glassmorphic Card */}
        <motion.div 
          className="backdrop-blur-xl bg-white/70 rounded-3xl shadow-2xl p-8 pt-16 border border-white/50"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        >
          {/* Header */}
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Welcome Back!
            </h1>
            <p className="text-gray-500 mt-1 text-sm">Sign in to your Salary System account</p>
          </div>

          {/* Attendance Notification */}
          <AnimatePresence>
            {attendance && (
              <motion.div 
                className={`p-4 rounded-xl border mb-4 ${getAttendanceStyles(attendance.status)}`}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <div className="flex items-start gap-3">
                  {getAttendanceIcon(attendance.status)}
                  <div>
                    <p className="font-medium capitalize">
                      Attendance: {attendance.status.replace('_', ' ')}
                    </p>
                    <p className="text-sm mt-1">{attendance.message}</p>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <AnimatePresence>
              {error && (
                <motion.div 
                  className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm flex items-center gap-2"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <AlertCircle className="h-4 w-4" />
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Username Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Username
              </label>
              <motion.input
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setIsPasswordFocused(false)}
                required
                className="w-full px-4 py-3 bg-white/80 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all duration-200 text-gray-900 placeholder-gray-400"
                whileFocus={{ scale: 1.01 }}
              />
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                Password
              </label>
              <motion.input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setIsPasswordFocused(true)}
                onBlur={() => setIsPasswordFocused(false)}
                required
                className="w-full px-4 py-3 bg-white/80 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all duration-200 text-gray-900 placeholder-gray-400"
                whileFocus={{ scale: 1.01 }}
              />
            </div>

            {/* Sign In Button */}
            <motion.button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/30 disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-200"
              whileHover={{ scale: loading ? 1 : 1.02 }}
              whileTap={{ scale: loading ? 1 : 0.98 }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </motion.button>
          </form>

          {/* Timezone */}
          <motion.div 
            className="mt-4 text-center text-xs text-gray-400 flex items-center justify-center gap-1"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            <Clock className="h-3 w-3" />
            Timezone: Asia/Karachi
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}

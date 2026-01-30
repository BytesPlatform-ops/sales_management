'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, X } from 'lucide-react';

type ButtonState = 'idle' | 'loading' | 'success' | 'error';

interface GamifiedSubmitButtonProps {
  onClick: () => Promise<boolean>; // Returns true for success, false for error
  disabled?: boolean;
  children?: React.ReactNode;
  onTransitionComplete?: () => void;
}

export function GamifiedSubmitButton({
  onClick,
  disabled = false,
  children = 'Sign In',
  onTransitionComplete,
}: GamifiedSubmitButtonProps) {
  const [state, setState] = useState<ButtonState>('idle');
  const [isExpanding, setIsExpanding] = useState(false);

  const handleClick = async () => {
    if (state !== 'idle' || disabled) return;

    setState('loading');

    try {
      const success = await onClick();
      
      if (success) {
        setState('success');
        // Start the expansion animation after showing checkmark
        setTimeout(() => {
          setIsExpanding(true);
        }, 600);
        // Trigger navigation after expansion
        setTimeout(() => {
          onTransitionComplete?.();
        }, 1200);
      } else {
        setState('error');
        // Reset to idle after shake animation
        setTimeout(() => {
          setState('idle');
        }, 800);
      }
    } catch {
      setState('error');
      setTimeout(() => {
        setState('idle');
      }, 800);
    }
  };

  // Button width based on state
  const getButtonWidth = () => {
    switch (state) {
      case 'loading':
      case 'success':
      case 'error':
        return '56px';
      default:
        return '100%';
    }
  };

  // Button colors based on state
  const getButtonColors = () => {
    switch (state) {
      case 'success':
        return 'from-emerald-500 to-emerald-600';
      case 'error':
        return 'from-red-500 to-red-600';
      default:
        return 'from-indigo-600 to-purple-600';
    }
  };

  // Shake animation for error
  const shakeAnimation = {
    x: [0, -10, 10, -10, 10, -5, 5, 0],
    transition: { duration: 0.5 }
  };

  return (
    <>
      {/* Expanding overlay for page transition */}
      <AnimatePresence>
        {isExpanding && (
          <motion.div
            layoutId="submit-button-expand"
            className="fixed inset-0 z-[100] bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center"
            initial={{ 
              opacity: 0,
              scale: 0,
              borderRadius: '9999px',
            }}
            animate={{ 
              opacity: 1,
              scale: 1,
              borderRadius: '0px',
            }}
            transition={{
              duration: 0.6,
              ease: [0.22, 1, 0.36, 1], // Custom easing for smooth expand
            }}
          >
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.3 }}
            >
              <Check className="w-20 h-20 text-white" strokeWidth={3} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main button */}
      <motion.button
        type="button"
        onClick={handleClick}
        disabled={disabled || state !== 'idle'}
        className={`
          relative overflow-hidden
          h-14 rounded-full
          bg-gradient-to-r ${getButtonColors()}
          text-white font-semibold
          shadow-lg shadow-indigo-500/30
          disabled:cursor-not-allowed
          transition-colors duration-300
          mx-auto flex items-center justify-center
        `}
        initial={false}
        animate={{
          width: getButtonWidth(),
          ...(state === 'error' ? shakeAnimation : {}),
        }}
        whileTap={state === 'idle' ? { scale: 0.95 } : {}}
        transition={{
          width: { 
            duration: 0.4, 
            ease: [0.4, 0, 0.2, 1] 
          },
        }}
        style={{
          boxShadow: state === 'success' 
            ? '0 10px 40px -10px rgba(16, 185, 129, 0.5)' 
            : state === 'error'
            ? '0 10px 40px -10px rgba(239, 68, 68, 0.5)'
            : '0 10px 40px -10px rgba(99, 102, 241, 0.5)',
        }}
      >
        {/* Idle state - Text */}
        <AnimatePresence mode="wait">
          {state === 'idle' && (
            <motion.span
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="whitespace-nowrap px-4"
            >
              {children}
            </motion.span>
          )}

          {/* Loading state - Spinner */}
          {state === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, scale: 0.5, rotate: -180 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3 }}
            >
              <Loader2 className="w-6 h-6 animate-spin" />
            </motion.div>
          )}

          {/* Success state - Checkmark */}
          {state === 'success' && !isExpanding && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ 
                type: 'spring',
                stiffness: 400,
                damping: 15,
              }}
            >
              <motion.div
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
              >
                <Check className="w-6 h-6" strokeWidth={3} />
              </motion.div>
            </motion.div>
          )}

          {/* Error state - X mark */}
          {state === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, scale: 0, rotate: -90 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0 }}
              transition={{ 
                type: 'spring',
                stiffness: 400,
                damping: 15,
              }}
            >
              <X className="w-6 h-6" strokeWidth={3} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Ripple effect on success */}
        {state === 'success' && (
          <motion.div
            className="absolute inset-0 bg-white rounded-full"
            initial={{ scale: 0, opacity: 0.5 }}
            animate={{ scale: 2, opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        )}
      </motion.button>
    </>
  );
}

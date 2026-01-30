'use client';

import { useRef, useState, ReactNode } from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'framer-motion';

interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
}

export function SpotlightCard({ 
  children, 
  className = '',
  spotlightColor = 'rgba(120, 119, 198, 0.15)'
}: SpotlightCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  
  // Motion values for mouse position
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Handle mouse move
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    mouseX.set(x);
    mouseY.set(y);
  };

  // Create radial gradient that follows mouse
  const spotlightBackground = useMotionTemplate`
    radial-gradient(
      350px circle at ${mouseX}px ${mouseY}px,
      ${spotlightColor},
      transparent 80%
    )
  `;

  // Border glow effect
  const borderGlow = useMotionTemplate`
    radial-gradient(
      400px circle at ${mouseX}px ${mouseY}px,
      rgba(120, 119, 198, 0.4),
      transparent 60%
    )
  `;

  return (
    <div
      ref={cardRef}
      className={`relative group ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      {/* Border glow layer */}
      <motion.div
        className="absolute -inset-px rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          background: borderGlow,
        }}
      />
      
      {/* Card container with spotlight */}
      <div className="relative rounded-3xl overflow-hidden">
        {/* Spotlight overlay */}
        <motion.div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none z-10"
          style={{
            background: spotlightBackground,
          }}
        />
        
        {/* Glassmorphic background */}
        <div className="relative backdrop-blur-xl bg-white/70 border border-white/50 shadow-2xl">
          {/* Inner spotlight for input highlighting */}
          <motion.div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
            style={{
              background: useMotionTemplate`
                radial-gradient(
                  250px circle at ${mouseX}px ${mouseY}px,
                  rgba(99, 102, 241, 0.08),
                  transparent 70%
                )
              `,
            }}
          />
          
          {/* Content */}
          <div className="relative z-20">
            {children}
          </div>
        </div>
      </div>

      {/* Ambient glow beneath card */}
      <motion.div
        className="absolute -bottom-4 left-1/2 -translate-x-1/2 w-3/4 h-8 rounded-full blur-2xl opacity-0 group-hover:opacity-60 transition-opacity duration-700 -z-10"
        style={{
          background: 'linear-gradient(90deg, rgba(99, 102, 241, 0.3), rgba(168, 85, 247, 0.3))',
        }}
        animate={{
          scale: isHovering ? [1, 1.05, 1] : 1,
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
      />
    </div>
  );
}

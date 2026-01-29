'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api-client';
import { Phone, PhoneOff, User, Clock, Loader2, CheckCircle, AlertCircle, List } from 'lucide-react';
import { cn } from '@/lib/utils';

type CallStatus = 'idle' | 'dialing' | 'in_call' | 'wrap_up' | 'complete';

interface Lead {
  id: number;
  name: string;
  phone_number: string;
  status: string;
  website?: string;
  notes?: string;
  last_called_at?: string;
  created_at?: string;
}

interface UpcomingLead {
  id: number;
  name: string;
  phone_number: string;
  website?: string;
  notes?: string;
}

interface PowerDialerProps {
  agentExtension: string;
  userId: number;
  onCallComplete?: (lead: Lead) => void;
}

export function PowerDialer({ agentExtension, userId, onCallComplete }: PowerDialerProps) {
  const [isDialing, setIsDialing] = useState(false);
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [upcomingLeads, setUpcomingLeads] = useState<UpcomingLead[]>([]);
  const [callStatus, setCallStatus] = useState<CallStatus>('idle');
  const [timer, setTimer] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [callsCompleted, setCallsCompleted] = useState(0);
  const [totalLeads, setTotalLeads] = useState(0);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const isDialingRef = useRef(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch leads on mount to show the queue
  useEffect(() => {
    async function fetchLeadsPreview() {
      try {
        const response = await api.getNextLead();
        if (response.data) {
          // Show the first lead as "next up" and the rest as upcoming
          const firstLead = response.data;
          const upcoming = response.upcoming || [];
          setUpcomingLeads([
            { id: firstLead.id, name: firstLead.name, phone_number: firstLead.phone_number, website: firstLead.website, notes: firstLead.notes },
            ...upcoming
          ]);
          setTotalLeads(1 + upcoming.length);
        }
      } catch (err) {
        console.error('Failed to fetch leads preview:', err);
      }
    }
    fetchLeadsPreview();
  }, []);

  // Keep ref in sync with state
  useEffect(() => {
    isDialingRef.current = isDialing;
  }, [isDialing]);

  // Fetch next lead and initiate call
  const dialNextLead = useCallback(async () => {
    if (!isDialingRef.current) return;
    
    setError(null);
    setCallStatus('dialing');

    try {
      // 1. Fetch next pending lead
      const nextResponse = await api.getNextLead();
      
      if (!nextResponse.data || !nextResponse.hasMore) {
        // No more leads
        setCallStatus('complete');
        setCurrentLead(null);
        setUpcomingLeads([]);
        setIsDialing(false);
        return;
      }

      const lead = nextResponse.data as Lead;
      setCurrentLead(lead);
      setUpcomingLeads(nextResponse.upcoming || []);

      // 2. Initiate call via 3CX
      const callResponse = await api.initiateCall(lead.id, agentExtension);
      
      if (callResponse.status === 'success') {
        setCallStatus('in_call');
        console.log(`📞 Call initiated to ${lead.name}`);
      } else {
        throw new Error(callResponse.message || 'Failed to initiate call');
      }
    } catch (err: any) {
      console.error('Dial error:', err);
      setError(err.message || 'Failed to dial');
      setCallStatus('idle');
    }
  }, [agentExtension]);

  // Start countdown and auto-dial next
  const startWrapUpTimer = useCallback(() => {
    setCallStatus('wrap_up');
    setTimer(5);

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    timerRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          // Auto-dial next lead
          if (isDialingRef.current) {
            dialNextLead();
          }
          return 5;
        }
        return prev - 1;
      });
    }, 1000);
  }, [dialNextLead]);

  // Set up Supabase Realtime subscription
  useEffect(() => {
    if (!isDialing || !userId) return;

    // Subscribe to daily_stats changes for this user
    const channel = supabase
      .channel(`daily_stats_${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'daily_stats',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          console.log('📊 daily_stats updated:', payload);
          
          // Call ended - detected via stats update from webhook
          if (callStatus === 'in_call' && isDialingRef.current) {
            setCallsCompleted((prev) => prev + 1);
            
            if (currentLead) {
              onCallComplete?.(currentLead);
            }
            
            // Start wrap-up countdown
            startWrapUpTimer();
          }
        }
      )
      .subscribe((status) => {
        console.log('🔌 Realtime subscription status:', status);
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [isDialing, userId, callStatus, currentLead, onCallComplete, startWrapUpTimer]);

  // Handle Start/Stop
  const handleToggle = () => {
    if (isDialing) {
      // Stop dialing
      setIsDialing(false);
      setCallStatus('idle');
      setCurrentLead(null);
      setUpcomingLeads([]);
      setTimer(5);
      
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    } else {
      // Start dialing
      setIsDialing(true);
      setCallsCompleted(0);
      setError(null);
      dialNextLead();
    }
  };

  // Skip current lead manually
  const handleSkip = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    dialNextLead();
  };

  // Get status display info
  const getStatusInfo = () => {
    switch (callStatus) {
      case 'idle':
        return { color: 'text-gray-500', bg: 'bg-gray-100', label: 'Ready' };
      case 'dialing':
        return { color: 'text-yellow-600', bg: 'bg-yellow-100', label: 'Dialing...' };
      case 'in_call':
        return { color: 'text-green-600', bg: 'bg-green-100', label: 'In Call' };
      case 'wrap_up':
        return { color: 'text-blue-600', bg: 'bg-blue-100', label: 'Wrap Up' };
      case 'complete':
        return { color: 'text-purple-600', bg: 'bg-purple-100', label: 'Complete' };
      default:
        return { color: 'text-gray-500', bg: 'bg-gray-100', label: 'Unknown' };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div className="bg-white rounded-2xl border shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Phone className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Power Dialer</h2>
              <p className="text-sm text-white/70">Auto-dial your leads</p>
            </div>
          </div>
          {callsCompleted > 0 && (
            <div className="text-right">
              <p className="text-2xl font-bold text-white">{callsCompleted}</p>
              <p className="text-xs text-white/70">Calls Made</p>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-6">
        {/* Status Badge */}
        <div className="flex items-center justify-center">
          <span className={cn(
            'px-4 py-2 rounded-full text-sm font-medium flex items-center gap-2',
            statusInfo.bg,
            statusInfo.color
          )}>
            {callStatus === 'dialing' && <Loader2 className="h-4 w-4 animate-spin" />}
            {callStatus === 'in_call' && <Phone className="h-4 w-4" />}
            {callStatus === 'complete' && <CheckCircle className="h-4 w-4" />}
            {statusInfo.label}
          </span>
        </div>

        {/* Current Lead Display */}
        {currentLead && (
          <div className="bg-gray-50 rounded-xl p-4 border space-y-4">
            {/* Lead Header */}
            <div className="flex items-center gap-4">
              <div className="p-3 bg-indigo-100 rounded-full">
                <User className="h-6 w-6 text-indigo-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900">{currentLead.name}</h3>
                <p className="text-gray-500 font-mono text-lg">{currentLead.phone_number}</p>
              </div>
            </div>

            {/* Lead Details */}
            <div className="border-t pt-3 space-y-2">
              {currentLead.website && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 uppercase w-16">Website</span>
                  <a 
                    href={currentLead.website.startsWith('http') ? currentLead.website : `https://${currentLead.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-indigo-600 hover:underline truncate flex-1"
                  >
                    {currentLead.website}
                  </a>
                </div>
              )}
              {currentLead.notes && (
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-gray-500 uppercase w-16 pt-0.5">Notes</span>
                  <p className="text-sm text-gray-700 flex-1 bg-white rounded p-2 border">
                    {currentLead.notes}
                  </p>
                </div>
              )}
              {currentLead.last_called_at && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-gray-500 uppercase w-16">Last Call</span>
                  <span className="text-sm text-gray-600">
                    {new Date(currentLead.last_called_at).toLocaleString()}
                  </span>
                </div>
              )}
              {!currentLead.website && !currentLead.notes && !currentLead.last_called_at && (
                <p className="text-sm text-gray-400 italic">No additional details available</p>
              )}
            </div>
          </div>
        )}

        {/* Countdown Timer (Wrap Up) */}
        {callStatus === 'wrap_up' && (
          <div className="flex flex-col items-center">
            <div className="relative w-24 h-24">
              <svg className="w-24 h-24 transform -rotate-90">
                <circle
                  cx="48"
                  cy="48"
                  r="44"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className="text-gray-200"
                />
                <circle
                  cx="48"
                  cy="48"
                  r="44"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={276.46}
                  strokeDashoffset={276.46 * (1 - timer / 5)}
                  className="text-blue-500 transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-3xl font-bold text-blue-600">{timer}</span>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-2">Next call in...</p>
            <button
              onClick={handleSkip}
              className="mt-2 text-sm text-blue-600 hover:underline"
            >
              Dial Now
            </button>
          </div>
        )}

        {/* Complete Message */}
        {callStatus === 'complete' && (
          <div className="text-center py-4">
            <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-900">List Complete!</h3>
            <p className="text-gray-500">You've called all your pending leads.</p>
            <p className="text-2xl font-bold text-indigo-600 mt-2">{callsCompleted} calls made</p>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Start/Stop Button */}
        <button
          onClick={handleToggle}
          disabled={callStatus === 'dialing'}
          className={cn(
            'w-full py-4 rounded-xl font-semibold text-lg transition-all flex items-center justify-center gap-3',
            isDialing
              ? 'bg-red-500 hover:bg-red-600 text-white'
              : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white',
            callStatus === 'dialing' && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isDialing ? (
            <>
              <PhoneOff className="h-6 w-6" />
              Stop Dialing
            </>
          ) : (
            <>
              <Phone className="h-6 w-6" />
              Start Dialing
            </>
          )}
        </button>

        {/* Instructions */}
        {!isDialing && callStatus === 'idle' && (
          <p className="text-center text-sm text-gray-400">
            Click Start to begin auto-dialing your pending leads
          </p>
        )}

        {/* Upcoming Leads List */}
        {upcomingLeads.length > 0 && (
          <div className="border-t pt-4">
            <div className="flex items-center gap-2 mb-3">
              <List className="h-4 w-4 text-gray-500" />
              <h4 className="text-sm font-semibold text-gray-700">
                {isDialing ? `Up Next (${upcomingLeads.length} leads)` : `Your Lead Queue (${upcomingLeads.length} leads)`}
              </h4>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {upcomingLeads.map((lead, index) => (
                <div 
                  key={lead.id} 
                  className={cn(
                    "flex items-center gap-3 p-2 rounded-lg border",
                    index === 0 && !isDialing 
                      ? "bg-indigo-50 border-indigo-200" 
                      : "bg-gray-50 border-gray-100"
                  )}
                >
                  <span className={cn(
                    "flex-shrink-0 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center",
                    index === 0 && !isDialing
                      ? "bg-indigo-500 text-white"
                      : "bg-indigo-100 text-indigo-600"
                  )}>
                    {index + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{lead.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{lead.phone_number}</p>
                  </div>
                  {lead.website && (
                    <span className="text-xs text-indigo-500 truncate max-w-[100px]" title={lead.website}>
                      🌐
                    </span>
                  )}
                  {lead.notes && (
                    <span className="text-xs text-yellow-500" title={lead.notes}>
                      📝
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* No Leads Message */}
        {upcomingLeads.length === 0 && callStatus === 'idle' && (
          <div className="border-t pt-4 text-center">
            <p className="text-gray-400 text-sm">No pending leads in your queue.</p>
            <p className="text-gray-400 text-xs mt-1">Import leads first to start dialing.</p>
          </div>
        )}
      </div>
    </div>
  );
}

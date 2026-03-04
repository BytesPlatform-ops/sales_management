'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Calendar,
  RefreshCw,
  Headphones,
  Phone,
  Clock,
  User,
  Hash,
  Volume2,
  AlertCircle,
  CheckCircle2,
  Shuffle,
  Settings,
  Save,
  X,
} from 'lucide-react';

interface SampledCall {
  sampleIndex: number;
  callId: number;
  agentName: string;
  agentExtension: string;
  agentId: number | null;
  callTime: string;
  callTimeFormatted: string;
  duration: string;
  durationSeconds: number;
  recordingDuration: string | null;      // Recording length (MM:SS or HH:MM:SS)
  recordingDurationSeconds: number | null;
  customerNumber: string;
  recordingUrl: string | null;
  // Verification fields
  auditItemId?: string;
  isVerified?: boolean;
  verifiedAt?: string | null;
}

interface AuditSampleResponse {
  success: boolean;
  auditExists: boolean;              // Whether an audit already exists for this date
  date: string;
  shiftStart: string;
  shiftEnd: string;
  totalValidCalls: number;
  sampleSize: number;
  samplingPercentage: number;
  sample: SampledCall[];
  message?: string;
  hasRecordingColumn?: boolean;
  recordingBaseUrlConfigured?: boolean;
  // Audit persistence fields
  auditId?: string | null;
  auditStatus?: string | null;     // 'pending' | 'completed'
  completedAt?: string | null;
  auditedBy?: string | null;
}

/**
 * Get yesterday's date in YYYY-MM-DD format (PKT timezone)
 * Since we audit past shifts, default to yesterday
 */
function getYesterdayDate(): string {
  const now = new Date();
  
  // Get current date in Asia/Karachi timezone
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  const todayStr = dateFormatter.format(now);
  const [year, month, day] = todayStr.split('-').map(Number);
  
  // Subtract one day
  const yesterday = new Date(year, month - 1, day - 1);
  return `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
}

/**
 * Format duration in seconds to MM:SS or HH:MM:SS
 */
function formatDuration(seconds: number): string {
  if (seconds < 0) return '00:00';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Format date for display
 */
function formatDisplayDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function HRAuditingPage() {
  const { user, loading: authLoading } = useAuth();
  const [selectedDate, setSelectedDate] = useState<string>(getYesterdayDate());
  const [auditData, setAuditData] = useState<AuditSampleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  
  // Recording URL configuration
  const [recordingBaseUrl, setRecordingBaseUrl] = useState<string>('');
  const [recordingAccessToken, setRecordingAccessToken] = useState<string>('');
  const [savingUrl, setSavingUrl] = useState(false);
  const [urlSaveMessage, setUrlSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  
  // Direct 3CX recording fetch
  const [fetchingRecordings, setFetchingRecordings] = useState(false);
  const [recordingsFetchMessage, setRecordingsFetchMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  
  // 3CX Connection Test
  const [testing3CX, setTesting3CX] = useState(false);
  const [test3CXResult, setTest3CXResult] = useState<any>(null);
  
  // Verification state
  const [verifyingItems, setVerifyingItems] = useState<Set<string>>(new Set());
  
  // Generating state (separate from loading)
  const [generating, setGenerating] = useState(false);

  /**
   * Fetch existing audit for the selected date (does NOT generate)
   * Called automatically when date changes or on mount
   */
  const fetchExistingAudit = useCallback(async () => {
    if (!selectedDate) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.fetchAudit(selectedDate);
      console.log('Audit FETCH response:', response);
      
      const auditResult = (response as any)?.data || response;
      
      if (auditResult?.error) {
        throw new Error(auditResult.error + (auditResult.details ? `: ${auditResult.details}` : ''));
      }
      
      setAuditData(auditResult as AuditSampleResponse);
      setHasFetched(true);
    } catch (err: any) {
      console.error('Error fetching audit:', err);
      setError(err.message || 'Failed to fetch audit');
      setAuditData(null);
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  /**
   * Generate a NEW 15% sample for the selected date
   * Only called when clicking the Generate button
   */
  const generateAuditSample = useCallback(async () => {
    if (!selectedDate) return;
    
    setGenerating(true);
    setError(null);
    
    try {
      const response = await api.generateAudit(selectedDate);
      console.log('Audit GENERATE response:', response);
      
      const auditResult = (response as any)?.data || response;
      
      if (auditResult?.error) {
        throw new Error(auditResult.error + (auditResult.details ? `: ${auditResult.details}` : ''));
      }
      
      setAuditData(auditResult as AuditSampleResponse);
      setHasFetched(true);
    } catch (err: any) {
      console.error('Error generating audit:', err);
      setError(err.message || 'Failed to generate audit sample');
    } finally {
      setGenerating(false);
    }
  }, [selectedDate]);

  /**
   * Legacy function for compatibility - now just calls fetchExistingAudit
   */
  const fetchAuditSample = fetchExistingAudit;

  /**
   * Auto-fetch existing audit when date changes
   */
  useEffect(() => {
    if (selectedDate && !authLoading && user?.role === 'hr') {
      fetchExistingAudit();
    }
  }, [selectedDate, authLoading, user, fetchExistingAudit]);

  /**
   * Load recording base URL setting on mount
   */
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await api.getSettings() as any;
        // Handle both wrapped and direct responses
        const data = response?.data || response;
        if (data?.success && data?.settings) {
          if (data.settings.recording_base_url) {
            setRecordingBaseUrl(data.settings.recording_base_url.value || '');
          }
          if (data.settings.recording_access_token) {
            setRecordingAccessToken(data.settings.recording_access_token.value || '');
          }
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      }
    };
    loadSettings();
  }, []);

  /**
   * Save recording settings
   */
  const saveRecordingSettings = async () => {
    setSavingUrl(true);
    setUrlSaveMessage(null);
    
    try {
      // Save both settings
      await api.updateSetting('recording_base_url', recordingBaseUrl);
      await api.updateSetting('recording_access_token', recordingAccessToken);
      
      setUrlSaveMessage({ type: 'success', text: 'Settings saved! Re-generate sample to apply.' });
      setTimeout(() => setUrlSaveMessage(null), 5000);
    } catch (err: any) {
      setUrlSaveMessage({ type: 'error', text: err.message || 'Failed to save settings' });
    } finally {
      setSavingUrl(false);
    }
  };

  /**
   * Test 3CX API connection
   */
  const test3CXConnection = async () => {
    setTesting3CX(true);
    setTest3CXResult(null);
    
    try {
      const response = await fetch('/api/hr/audit/test-3cx', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
      });
      
      const data = await response.json();
      setTest3CXResult(data);
    } catch (err: any) {
      setTest3CXResult({ success: false, error: err.message });
    } finally {
      setTesting3CX(false);
    }
  };

  /**
   * Fetch recordings directly from 3CX API and match to sampled calls
   */
  const fetchRecordingsFrom3CX = async () => {
    if (!auditData || auditData.sample.length === 0) return;
    
    setFetchingRecordings(true);
    setRecordingsFetchMessage({ type: 'info', text: 'Fetching recordings from 3CX...' });
    
    try {
      // First, try to match recordings to our sampled calls
      const callIds = auditData.sample.map(c => c.callId);
      
      const response = await fetch('/api/hr/audit/recordings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ callIds }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || `Failed: ${response.status}`);
      }
      
      if (data.matched > 0) {
        setRecordingsFetchMessage({
          type: 'success',
          text: `Matched ${data.matched}/${data.total} calls to 3CX recordings! Refreshing...`
        });
        
        // Re-fetch the audit sample to get updated recording URLs
        setTimeout(() => {
          fetchAuditSample();
          setRecordingsFetchMessage(null);
        }, 1500);
      } else {
        setRecordingsFetchMessage({
          type: 'error',
          text: `No recordings matched. 3CX may not have recordings for these calls.`
        });
        setTimeout(() => setRecordingsFetchMessage(null), 5000);
      }
    } catch (err: any) {
      console.error('Error fetching recordings:', err);
      setRecordingsFetchMessage({
        type: 'error',
        text: err.message || 'Failed to fetch recordings from 3CX'
      });
      setTimeout(() => setRecordingsFetchMessage(null), 5000);
    } finally {
      setFetchingRecordings(false);
    }
  };

  /**
   * Mark an audit item as verified
   */
  const verifyAuditItem = async (auditItemId: string) => {
    if (!auditData?.auditId) return;
    
    setVerifyingItems(prev => new Set(prev).add(auditItemId));
    
    try {
      const response = await fetch('/api/hr/audit/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ 
          auditItemId,
          auditId: auditData.auditId,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to verify');
      }
      
      // Update local state
      setAuditData(prev => {
        if (!prev) return prev;
        
        const updatedSample = prev.sample.map(call => 
          call.auditItemId === auditItemId 
            ? { ...call, isVerified: true, verifiedAt: new Date().toISOString() }
            : call
        );
        
        // Check if all items are now verified
        const allVerified = updatedSample.every(call => call.isVerified);
        
        return {
          ...prev,
          sample: updatedSample,
          auditStatus: allVerified ? 'completed' : prev.auditStatus,
          completedAt: allVerified ? new Date().toISOString() : prev.completedAt,
          auditedBy: allVerified ? user?.full_name || user?.username : prev.auditedBy,
        };
      });
      
    } catch (err: any) {
      console.error('Error verifying audit item:', err);
      alert(err.message || 'Failed to verify item');
    } finally {
      setVerifyingItems(prev => {
        const next = new Set(prev);
        next.delete(auditItemId);
        return next;
      });
    }
  };

  // Redirect if not HR
  useEffect(() => {
    if (!authLoading && user && user.role !== 'hr') {
      window.location.href = '/agent';
    }
  }, [user, authLoading]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user || user.role !== 'hr') {
    return null;
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Headphones className="h-7 w-7 text-purple-600" />
            Call Auditing (QA Module)
          </h1>
          <p className="text-gray-600 mt-1">
            Review all call recordings (≥1 min) for quality assurance
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowConfigPanel(!showConfigPanel)}
          className="flex items-center gap-2"
        >
          <Settings className="h-4 w-4" />
          {showConfigPanel ? 'Hide' : 'Configure'} Recordings
        </Button>
      </div>

      {/* Configuration Panel */}
      {showConfigPanel && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-blue-900 flex items-center gap-2">
                <Settings className="h-4 w-4" />
                3CX Recording Configuration
              </h3>
              <p className="text-xs text-blue-700 mt-1">
                Enter your 3CX recording server URL to enable playback. The system will construct URLs as: <code className="bg-blue-100 px-1 rounded">{'{base_url}/{call_id}.wav'}</code>
              </p>
            </div>
            <button onClick={() => setShowConfigPanel(false)} className="text-blue-500 hover:text-blue-700">
              <X className="h-4 w-4" />
            </button>
          </div>
          
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-blue-800 mb-1">
                Recording Base URL
              </label>
              <input
                type="text"
                value={recordingBaseUrl}
                onChange={(e) => setRecordingBaseUrl(e.target.value)}
                placeholder="https://bytesplatform.tx.3cx.us/xapi/v1/Recordings/Pbx.DownloadRecording"
                className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            
            <div>
              <label className="block text-xs font-medium text-blue-800 mb-1">
                3CX Access Token (JWT)
              </label>
              <input
                type="password"
                value={recordingAccessToken}
                onChange={(e) => setRecordingAccessToken(e.target.value)}
                placeholder="eyJhbGciOiJFUzI1NiIsImtpZCI6..."
                className="w-full px-3 py-2 text-sm border border-blue-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              />
              <p className="text-xs text-blue-500 mt-1">
                Get this from 3CX Admin → API → Generate Token
              </p>
            </div>
            
            <Button
              onClick={saveRecordingSettings}
              disabled={savingUrl}
              size="sm"
              className="flex items-center gap-2"
            >
              {savingUrl ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Settings
            </Button>
            
            <Button
              onClick={test3CXConnection}
              disabled={testing3CX}
              variant="outline"
              size="sm"
              className="flex items-center gap-2 ml-2"
            >
              {testing3CX ? <RefreshCw className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
              Test 3CX Connection
            </Button>
          </div>
          
          {urlSaveMessage && (
            <p className={`text-xs mt-2 flex items-center gap-1 ${urlSaveMessage.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
              {urlSaveMessage.type === 'success' ? <CheckCircle2 className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
              {urlSaveMessage.text}
            </p>
          )}
          
          {/* 3CX Test Results */}
          {test3CXResult && (
            <div className={`mt-3 p-3 rounded-lg text-xs ${test3CXResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <p className={`font-semibold ${test3CXResult.success ? 'text-green-800' : 'text-red-800'}`}>
                {test3CXResult.success ? '✅ Connection Successful' : '❌ Connection Failed'}
              </p>
              {test3CXResult.error && <p className="text-red-700 mt-1">{test3CXResult.error}</p>}
              {test3CXResult.diagnostics && (
                <div className="mt-2 text-gray-600">
                  <p>Token Type: {test3CXResult.diagnostics.tokenType || 'Unknown'}</p>
                  <p>Token Preview: {test3CXResult.diagnostics.tokenPreview || 'N/A'}</p>
                </div>
              )}
              {test3CXResult.endpointTests && (
                <div className="mt-2 space-y-1">
                  {test3CXResult.endpointTests.map((test: any, i: number) => (
                    <p key={i} className={test.workingAuth ? 'text-green-600' : 'text-gray-500'}>
                      {test.workingAuth ? '✓' : '✗'} {test.endpoint}: {test.workingAuth || 'Failed'}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          
          <div className="text-xs text-blue-600 mt-3 p-3 bg-blue-100 rounded-lg">
            <strong>⚠️ Important:</strong> Recording playback requires:
            <ol className="list-decimal ml-4 mt-1 space-y-1">
              <li>Your 3CX webhook must send <code className="bg-white px-1 rounded">[CallId]</code> to capture recording IDs</li>
              <li>A valid 3CX API access token (tokens expire - you may need to refresh)</li>
            </ol>
          </div>
        </div>
      )}

      {/* Date Selection & Generate Sample */}
      <div className="bg-white rounded-lg shadow-sm border p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
          {/* Date Picker */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Calendar className="inline h-4 w-4 mr-1" />
              Shift Date
            </label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setHasFetched(false);
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              max={getYesterdayDate()}
            />
            <p className="text-xs text-gray-500 mt-1">
              Shift: 9:00 PM → 5:00 AM PKT (overnight)
            </p>
          </div>

          {/* Generate Sample Button - only show when no audit exists */}
          {auditData?.auditExists ? (
            <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-green-700 font-medium">Sample Generated</span>
            </div>
          ) : (
            <Button
              onClick={generateAuditSample}
              disabled={generating || loading || !selectedDate}
              className="bg-purple-600 hover:bg-purple-700 text-white px-6"
            >
              {generating ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : loading ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <Shuffle className="h-4 w-4 mr-2" />
                  Generate Audit Sample
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Results Section */}
      {hasFetched && auditData && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Calendar className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Shift Date</p>
                  <p className="font-semibold text-gray-900">{formatDisplayDate(auditData.date)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Phone className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total Valid Calls</p>
                  <p className="font-semibold text-gray-900">{auditData.totalValidCalls}</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <Headphones className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Calls to Audit</p>
                  <p className="font-semibold text-gray-900">{auditData.sampleSize} calls</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-sm border p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Clock className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Shift Window</p>
                  <p className="font-semibold text-gray-900 text-sm">{auditData.shiftStart} → {auditData.shiftEnd}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Sample Calls Table */}
          {auditData.sample.length > 0 ? (
            <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
              {/* Audited Banner - Shows when all calls are verified */}
              {auditData.auditStatus === 'completed' && (
                <div className="bg-gradient-to-r from-green-500 to-emerald-500 px-6 py-4 flex items-center justify-center gap-3">
                  <div className="flex items-center gap-2 bg-white/20 backdrop-blur-sm rounded-full px-4 py-2">
                    <CheckCircle2 className="h-6 w-6 text-white" />
                    <span className="text-white font-bold text-lg">DAY FULLY AUDITED & VERIFIED</span>
                  </div>
                  {auditData.completedAt && auditData.auditedBy && (
                    <span className="text-white/90 text-sm">
                      by {auditData.auditedBy} on {new Date(auditData.completedAt).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric', 
                        hour: '2-digit', 
                        minute: '2-digit' 
                      })}
                    </span>
                  )}
                </div>
              )}
              
              <div className="px-6 py-4 border-b bg-gray-50">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                      <Volume2 className="h-5 w-5 text-purple-600" />
                      Sampled Calls for Review
                      {auditData.auditStatus === 'pending' && (
                        <span className="ml-2 text-xs font-medium bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                          {auditData.sample.filter(c => c.isVerified).length}/{auditData.sample.length} verified
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Listen to each recording and click &quot;Verify&quot; when reviewed
                    </p>
                  </div>
                  
                  {/* Fetch Recordings Button */}
                  <div className="flex flex-col items-end gap-2">
                    <Button
                      onClick={fetchRecordingsFrom3CX}
                      disabled={fetchingRecordings}
                      variant="outline"
                      size="sm"
                      className="border-purple-300 text-purple-700 hover:bg-purple-50"
                    >
                      {fetchingRecordings ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Fetching...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Fetch Recordings from 3CX
                        </>
                      )}
                    </Button>
                    {recordingsFetchMessage && (
                      <p className={`text-xs flex items-center gap-1 ${
                        recordingsFetchMessage.type === 'success' ? 'text-green-600' :
                        recordingsFetchMessage.type === 'error' ? 'text-red-600' : 'text-blue-600'
                      }`}>
                        {recordingsFetchMessage.type === 'success' ? <CheckCircle2 className="h-3 w-3" /> :
                         recordingsFetchMessage.type === 'error' ? <AlertCircle className="h-3 w-3" /> :
                         <RefreshCw className="h-3 w-3 animate-spin" />}
                        {recordingsFetchMessage.text}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gray-50">
                      <TableHead className="w-12 text-center">#</TableHead>
                      <TableHead>
                        <User className="inline h-4 w-4 mr-1" />
                        Agent
                      </TableHead>
                      <TableHead>
                        <Hash className="inline h-4 w-4 mr-1" />
                        Customer #
                      </TableHead>
                      <TableHead className="w-24">
                        <Clock className="inline h-4 w-4 mr-1" />
                        Duration
                      </TableHead>
                      <TableHead className="min-w-[320px]">
                        <Headphones className="inline h-4 w-4 mr-1" />
                        Recording
                      </TableHead>
                      <TableHead className="w-28 text-center">
                        <CheckCircle2 className="inline h-4 w-4 mr-1" />
                        Verify
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditData.sample.map((call) => (
                      <TableRow 
                        key={call.callId} 
                        className={`hover:bg-gray-50 ${call.isVerified ? 'bg-green-50/50' : ''}`}
                      >
                        <TableCell className="text-center font-medium text-gray-500">
                          {call.sampleIndex}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium text-gray-900">{call.agentName}</p>
                            <p className="text-xs text-gray-500">Ext: {call.agentExtension}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-mono text-sm text-gray-700">{call.customerNumber || '-'}</span>
                        </TableCell>
                        <TableCell>
                          {call.recordingDuration ? (
                            <span className="font-mono text-sm text-gray-700 bg-gray-100 px-2 py-1 rounded">
                              {call.recordingDuration}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {call.recordingUrl ? (
                            <audio
                              controls
                              className="w-full min-w-[280px] h-10"
                              preload="none"
                            >
                              <source src={call.recordingUrl} type="audio/mpeg" />
                              <source src={call.recordingUrl} type="audio/wav" />
                              <source src={call.recordingUrl} type="audio/ogg" />
                              Your browser does not support the audio element.
                            </audio>
                          ) : (
                            <span className="text-xs text-gray-400 italic">No recording available</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {call.isVerified ? (
                            <div className="flex items-center justify-center gap-1 text-green-600">
                              <CheckCircle2 className="h-5 w-5" />
                              <span className="text-xs font-medium">Verified</span>
                            </div>
                          ) : call.auditItemId ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => verifyAuditItem(call.auditItemId!)}
                              disabled={verifyingItems.has(call.auditItemId)}
                              className="border-green-300 text-green-700 hover:bg-green-50 hover:border-green-400"
                            >
                              {verifyingItems.has(call.auditItemId) ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
                                  Verify
                                </>
                              )}
                            </Button>
                          ) : (
                            <span className="text-xs text-orange-500" title="Run database migration to enable">
                              Setup needed
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Footer note */}
              <div className="px-6 py-3 bg-gray-50 border-t space-y-2">
                <p className="text-xs text-gray-500 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  Showing {auditData.sample.length} calls (≥1 min) from this shift
                </p>
                {auditData.auditStatus === 'pending' && (
                  <p className="text-xs text-blue-600 flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    {auditData.sample.filter(c => c.isVerified).length === 0 
                      ? 'Click "Verify" on each call after reviewing to mark day as audited'
                      : `${auditData.sample.length - auditData.sample.filter(c => c.isVerified).length} more calls to verify`
                    }
                  </p>
                )}
                {auditData.recordingBaseUrlConfigured === false && (
                  <p className="text-xs text-orange-600 flex items-center gap-1">
                    <AlertCircle className="h-4 w-4" />
                    Recording playback not configured. Set <code className="bg-orange-100 px-1 rounded">recording_base_url</code> in system_settings to enable playback.
                  </p>
                )}
              </div>
            </div>
          ) : auditData.auditExists === false ? (
            /* No audit exists for this date - show generate prompt */
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-8 text-center">
              <Shuffle className="h-12 w-12 text-blue-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-blue-800 mb-2">No Audit Generated Yet</h3>
              <p className="text-blue-700">
                No quality audit has been generated for the shift on {formatDisplayDate(auditData.date)}.
              </p>
              <p className="text-sm text-blue-600 mt-2">
                Click the &quot;Generate Audit Sample&quot; button above to load all calls for review.
              </p>
            </div>
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 text-center">
              <AlertCircle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-yellow-800 mb-2">No Recordings Found</h3>
              <p className="text-yellow-700">
                {auditData.message || `No eligible calls with recordings were found for the shift on ${formatDisplayDate(auditData.date)}.`}
              </p>
              <p className="text-sm text-yellow-600 mt-2">
                This could mean:
              </p>
              <ul className="text-sm text-yellow-600 mt-1 space-y-1">
                <li>• No calls were made during this shift</li>
                <li>• All calls were under 1 minute (voicemails)</li>
                <li>• Recordings haven&apos;t been uploaded yet by 3CX</li>
              </ul>
            </div>
          )}
        </>
      )}

      {/* Loading State */}
      {loading && !hasFetched && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
          <RefreshCw className="h-12 w-12 text-purple-500 mx-auto mb-4 animate-spin" />
          <h3 className="text-lg font-medium text-gray-700 mb-2">Loading Audit Data...</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Checking for existing audit data for the selected date.
          </p>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { Upload, FileText, AlertCircle, CheckCircle, Loader2, X, FileUp } from 'lucide-react';

interface ParsedLead {
  name: string;
  phone_number: string;
  website?: string;
  notes?: string;
}

export default function AgentLeadsPage() {
  const [csvData, setCsvData] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string; count?: number } | null>(null);
  const [preview, setPreview] = useState<ParsedLead[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Parse CSV data for preview
  const parseCSV = (csv: string): ParsedLead[] => {
    const lines = csv.trim().split('\n');
    if (lines.length === 0) return [];

    const leads: ParsedLead[] = [];
    
    // Check if first line is a header
    const firstLine = lines[0].toLowerCase();
    const hasHeader = firstLine.includes('name') || firstLine.includes('phone') || firstLine.includes('number');
    const startIndex = hasHeader ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle both comma and tab separated
      const parts = line.includes('\t') ? line.split('\t') : line.split(',');
      
      if (parts.length >= 2) {
        leads.push({
          name: parts[0]?.trim() || 'Unknown',
          phone_number: parts[1]?.trim() || '',
          website: parts[2]?.trim() || undefined,
          notes: parts[3]?.trim() || undefined,
        });
      }
    }

    return leads;
  };

  // Read file content
  const readFile = (file: File) => {
    if (!file.name.endsWith('.csv') && !file.type.includes('csv') && !file.type.includes('text')) {
      setResult({ success: false, message: 'Please upload a CSV file' });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setCsvData(text);
      setFileName(file.name);
      setResult(null);
    };
    reader.onerror = () => {
      setResult({ success: false, message: 'Failed to read file' });
    };
    reader.readAsText(file);
  };

  // Handle file drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      readFile(file);
    }
  }, []);

  // Handle file select
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      readFile(file);
    }
  };

  // Handle drag events
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  // Clear file
  const clearFile = () => {
    setCsvData('');
    setFileName(null);
    setPreview([]);
    setResult(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Update preview when CSV changes
  useEffect(() => {
    if (csvData.trim()) {
      const parsed = parseCSV(csvData);
      setPreview(parsed.slice(0, 5)); // Show first 5 for preview
    } else {
      setPreview([]);
    }
  }, [csvData]);

  // Handle upload
  const handleUpload = async () => {
    if (!csvData.trim()) {
      setResult({ success: false, message: 'Please select a CSV file' });
      return;
    }

    const leads = parseCSV(csvData);
    if (leads.length === 0) {
      setResult({ success: false, message: 'No valid leads found in CSV' });
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const response = await api.importMyLeads(leads);
      
      if (response.status === 'success') {
        setResult({
          success: true,
          message: `Successfully imported ${response.data?.count || leads.length} leads`,
          count: response.data?.count || leads.length,
        });
        setCsvData('');
        setFileName(null);
        setPreview([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      } else {
        throw new Error(response.message || 'Import failed');
      }
    } catch (error: any) {
      setResult({
        success: false,
        message: error.message || 'Failed to import leads',
      });
    } finally {
      setLoading(false);
    }
  };

  const totalLeads = csvData.trim() ? parseCSV(csvData).length : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">📋 Import Leads</h1>
        <p className="text-gray-500">Upload your leads from CSV for the Power Dialer</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column - Input */}
        <div className="space-y-4">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* Drag & Drop Zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => !fileName && fileInputRef.current?.click()}
            className={`
              relative bg-white rounded-xl border-2 border-dashed shadow-sm p-8 transition-all cursor-pointer
              ${isDragging 
                ? 'border-indigo-500 bg-indigo-50' 
                : fileName 
                  ? 'border-green-300 bg-green-50' 
                  : 'border-gray-300 hover:border-indigo-400 hover:bg-gray-50'
              }
            `}
          >
            {fileName ? (
              /* File Selected State */
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="h-8 w-8 text-green-600" />
                </div>
                <p className="text-lg font-semibold text-gray-900 mb-1">{fileName}</p>
                <p className="text-sm text-gray-500 mb-4">
                  {totalLeads} leads detected
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearFile();
                  }}
                  className="inline-flex items-center gap-1 text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  <X className="h-4 w-4" />
                  Remove file
                </button>
              </div>
            ) : (
              /* Empty State */
              <div className="text-center">
                <div className={`
                  w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 transition-colors
                  ${isDragging ? 'bg-indigo-100' : 'bg-gray-100'}
                `}>
                  <FileUp className={`h-8 w-8 ${isDragging ? 'text-indigo-600' : 'text-gray-400'}`} />
                </div>
                <p className="text-lg font-semibold text-gray-900 mb-1">
                  {isDragging ? 'Drop your CSV file here' : 'Drag & drop your CSV file'}
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  or click to browse
                </p>
                <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-medium px-3 py-1 rounded-full">
                  .csv files only
                </span>
              </div>
            )}
          </div>

          {/* Upload Button */}
          <button
            onClick={handleUpload}
            disabled={loading || !csvData.trim()}
            className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold py-4 rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                Import {totalLeads > 0 ? `${totalLeads} Leads` : 'Leads'}
              </>
            )}
          </button>

          {/* Result Message */}
          {result && (
            <div
              className={`rounded-lg p-4 flex items-center gap-3 ${
                result.success
                  ? 'bg-green-50 border border-green-200'
                  : 'bg-red-50 border border-red-200'
              }`}
            >
              {result.success ? (
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
              ) : (
                <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
              )}
              <p className={result.success ? 'text-green-700' : 'text-red-700'}>
                {result.message}
              </p>
            </div>
          )}
        </div>

        {/* Right Column - Preview */}
        <div className="bg-white rounded-xl border shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            👁️ Preview (First 5 rows)
          </h2>
          
          {preview.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <FileText className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Select a CSV file to see preview</p>
            </div>
          ) : (
            <div className="space-y-3">
              {preview.map((lead, index) => (
                <div
                  key={index}
                  className="bg-gray-50 rounded-lg p-4 border"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{lead.name}</p>
                      <p className="text-sm text-gray-600 font-mono">{lead.phone_number}</p>
                    </div>
                    <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-1 rounded">
                      #{index + 1}
                    </span>
                  </div>
                  {(lead.website || lead.notes) && (
                    <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500">
                      {lead.website && <p>🌐 {lead.website}</p>}
                      {lead.notes && <p>📝 {lead.notes}</p>}
                    </div>
                  )}
                </div>
              ))}
              {totalLeads > 5 && (
                <p className="text-center text-sm text-gray-500">
                  ... and {totalLeads - 5} more leads
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
        <h3 className="font-semibold text-blue-900 mb-2">📖 CSV Format Guide</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Each row should contain: <code className="bg-blue-100 px-1 rounded">Name, Phone, Website, Notes</code></li>
          <li>• Only Name and Phone are required</li>
          <li>• Headers are optional (will be auto-detected)</li>
          <li>• Supports both comma (,) and tab-separated values</li>
          <li>• All imported leads will be available in your Power Dialer</li>
        </ul>
      </div>
    </div>
  );
}

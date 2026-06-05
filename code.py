import csv
import os
import re

# --- CONFIGURATION ---
FILE_PATH = "/Users/bytes/Desktop/3cx/report.csv"  # Ensure this path is correct
# ---------------------

def parse_duration(duration_str):
    """Converts HH:MM:SS to seconds"""
    try:
        if not duration_str: return 0
        parts = duration_str.split(':')
        if len(parts) == 3:
            h, m, s = map(int, parts)
            return h * 3600 + m * 60 + s
        return 0
    except:
        return 0

def clean_extension(from_str):
    """
    Extracts the extension number from formats like "19 19 (19)" or uses the raw number.
    Returns just the number (e.g., "19").
    """
    if not from_str: return "Unknown"
    
    # Check for format "Name (Ext)" -> extract content inside parentheses
    match = re.search(r'\((.*?)\)', from_str)
    if match:
        return match.group(1)
    
    # If no parentheses, return the raw string (likely an external number)
    return from_str

def format_seconds(seconds):
    """Converts seconds back to HH:MM:SS"""
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"

def analyze_csv(file_path):
    agent_stats = {} 

    if not os.path.exists(file_path):
        print(f"❌ Error: File not found at {file_path}")
        return

    print(f"📂 Reading File: {file_path}...\n")

    try:
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            
            # Verify required columns exist
            required = ['From', 'Talking', 'Status', 'Direction']
            if not all(col in reader.fieldnames for col in required):
                print(f"❌ Error: Missing columns. Found: {reader.fieldnames}")
                return

            for row in reader:
                # 1. FILTER: We generally only want "Outbound" calls for sales agents
                # Use 'Inbound' or remove this check if you want everything.
                # direction = row.get('Direction')
                
                # 2. STATUS: Only count 'Answered' calls?
                status = row.get('Status')
                if status != 'Answered':
                    continue

                # 3. EXTRACT DATA
                raw_from = row.get('From')
                talking_str = row.get('Talking') # This is your duration field
                
                extension = clean_extension(raw_from)
                secs = parse_duration(talking_str)

                # 4. AGGREGATE
                if extension not in agent_stats:
                    agent_stats[extension] = {'calls': 0, 'seconds': 0}

                agent_stats[extension]['calls'] += 1
                agent_stats[extension]['seconds'] += secs

    except Exception as e:
        print(f"❌ Error reading file: {e}")
        return

    # --- OUTPUT ---
    print("="*45)
    print(f"{'EXTENSION':<15} | {'CALLS':<10} | {'TALK TIME'}")
    print("="*45)
    
    for ext, data in agent_stats.items():
        pretty_time = format_seconds(data['seconds'])
        print(f"{ext:<15} | {data['calls']:<10} | {pretty_time}")

if __name__ == "__main__":
    analyze_csv(FILE_PATH)
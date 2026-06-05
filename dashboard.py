# import psycopg2
# import time
# import sys
# from datetime import datetime

# # --- CONFIGURATION ---
# DB_CONFIG = {
#     "host": "aws-1-ap-southeast-2.pooler.supabase.com",
#     "port": "6543",
#     "database": "postgres",
#     "user": "postgres.wcwaslfuvuboexuldtzy",
#     "password": "!Bytes!0712"  # <--- Apna Password Yahan Daalein
# }


# def clear_screen():
#     """Forces the terminal to clear on Mac"""
#     print("\033c", end="")

# def get_seconds(duration_str):
#     """Converts 'HH:MM:SS' or 'MM:SS' to integer seconds"""
#     try:
#         if not duration_str: return 0
        
#         # Safely remove spaces
#         duration_str = str(duration_str).strip()
        
#         parts = duration_str.split(':')
        
#         if len(parts) == 3: # HH:MM:SS
#             h, m, s = map(int, parts)
#             return h * 3600 + m * 60 + s
#         elif len(parts) == 2: # MM:SS
#             m, s = map(int, parts)
#             return m * 60 + s
#         elif len(parts) == 1: # Just Seconds
#             return int(parts[0])
            
#         return 0
#     except:
#         return 0

# def format_time(seconds):
#     """Converts seconds back to HH:MM:SS"""
#     m, s = divmod(seconds, 60)
#     h, m = divmod(m, 60)
#     return f"{h:02d}:{m:02d}:{s:02d}"

# def fetch_stats():
#     """Connects to DB and fetches TODAY's calls"""
#     stats = {}
    
#     try:
#         conn = psycopg2.connect(**DB_CONFIG)
#         cur = conn.cursor()
        
#         # Query: Get all calls that happened TODAY
#         query = """
#             SELECT agent_extension, call_duration 
#             FROM call_logs 
#             WHERE call_time::date = CURRENT_DATE
#         """
#         cur.execute(query)
#         rows = cur.fetchall()
        
#         for agent, duration in rows:
#             if agent not in stats:
#                 stats[agent] = {'calls': 0, 'seconds': 0}
            
#             # --- DEBUG LINE (Agar time abhi bhi 0 aaye to isse uncomment karein) ---
#             # print(f"DEBUG: Agent {agent} Duration Raw: {duration}") 
            
#             stats[agent]['calls'] += 1
#             stats[agent]['seconds'] += get_seconds(duration)
            
#         cur.close()
#         conn.close()
#         return stats

#     except Exception as e:
#         return {"error": str(e)}

# def show_dashboard():
#     while True:
#         # 1. Force Clear Screen
#         clear_screen()
        
#         print(f"🔄 Fetching Live Data... ({datetime.now().strftime('%H:%M:%S')})")
#         data = fetch_stats()
        
#         if "error" in data:
#             print(f"\n❌ Database Error:\n{data['error']}")
#             time.sleep(5)
#             continue

#         # 2. Print Dashboard
#         print("\n" + "━"*52)
#         print(f"   📞  REAL-TIME SALES TEAM DASHBOARD  📞")
#         print("━"*52)
#         print(f"{'AGENT':<15} | {'CALLS':<10} | {'TALK TIME':<12} | {'AVG CALL'}")
#         print("─"*52)
        
#         if not data:
#             print("   Waiting for calls today...")
        
#         total_calls = 0
#         total_secs = 0

#         for agent in sorted(data.keys()):
#             calls = data[agent]['calls']
#             secs = data[agent]['seconds']
#             avg = secs // calls if calls > 0 else 0
            
#             total_calls += calls
#             total_secs += secs
            
#             print(f"{agent:<15} | {calls:<10} | {format_time(secs):<12} | {format_time(avg)}")
        
#         print("─"*52)
#         print(f"{'TOTAL':<15} | {total_calls:<10} | {format_time(total_secs):<12}")
#         print("━"*52)
#         print("\n(Press Ctrl+C to stop)")
        
#         # 3. Wait 2 seconds before refresh
#         time.sleep(2)

# if __name__ == "__main__":
#     show_dashboard()


import psycopg2
import time
import sys
from datetime import datetime, timedelta
import pytz # <--- Ye zaroori hai Pakistan Time ke liye

# --- CONFIGURATION ---
DB_CONFIG = {
    "host": "aws-1-ap-southeast-2.pooler.supabase.com",
    "port": "6543",
    "database": "postgres",
    "user": "postgres.wcwaslfuvuboexuldtzy",
    "password": "!Bytes!0712"
}

# --- TIMEZONE SETTING ---
PKT = pytz.timezone('Asia/Karachi') # <--- Hamesha Pakistan Time chalega

def clear_screen():
    print("\033c", end="")

def get_seconds(duration_str):
    try:
        if not duration_str: return 0
        duration_str = str(duration_str).strip()
        parts = duration_str.split(':')
        if len(parts) == 3: return int(parts[0])*3600 + int(parts[1])*60 + int(parts[2])
        elif len(parts) == 2: return int(parts[0])*60 + int(parts[1])
        elif len(parts) == 1: return int(parts[0])
        return 0
    except:
        return 0

def format_time(seconds):
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"

def get_shift_start_time():
    """
    Calculates 9:00 PM PKT start time based on 5:00 AM reset rule.
    """
    # Ab hum System time nahi, balki Pakistan Time le rahe hain
    now_pkt = datetime.now(PKT)
    
    # Reset time is Today 5:00 AM PKT
    reset_time = now_pkt.replace(hour=5, minute=0, second=0, microsecond=0)
    
    if now_pkt < reset_time:
        # Agar abhi Subah 5 baje se pehle ka waqt hai (e.g. 2 AM PKT)
        # To Shift Start = Yesterday 9 PM PKT
        shift_start = (now_pkt - timedelta(days=1)).replace(hour=21, minute=0, second=0, microsecond=0)
    else:
        # Agar 5 baj chuke hain (e.g. 10 AM or 9 PM PKT)
        # To Shift Start = Today 9 PM PKT
        shift_start = now_pkt.replace(hour=21, minute=0, second=0, microsecond=0)
        
    return shift_start, now_pkt

def fetch_stats():
    stats = {}
    shift_start, now_pkt = get_shift_start_time()
    
    # Database UTC mein time store karta hai, isliye humein query mein adjust karna padega
    # Ya hum Python se hi filter kar lete hain (simpler logic)
    
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        # Hum Database se pichle 24 ghante ka data mangwayenge
        # Aur Python mein filter karenge taake Timezone ka masla na ho
        query = """
            SELECT agent_extension, call_duration, call_time 
            FROM call_logs 
            WHERE call_time >= NOW() - INTERVAL '24 hours'
        """
        cur.execute(query)
        rows = cur.fetchall()
        
        for agent, duration, call_time_utc in rows:
            # Database se time UTC mein aata hai, usse PKT mein convert karo
            if call_time_utc.tzinfo is None:
                # Agar DB se naive time aaya to usse UTC maano
                call_time_utc = pytz.utc.localize(call_time_utc)
            
            call_time_pkt = call_time_utc.astimezone(PKT)
            
            # Agar Call Time humare Shift Start ke baad hai, tabhi count karo
            if call_time_pkt >= shift_start:
                if agent not in stats:
                    stats[agent] = {'calls': 0, 'seconds': 0}
                
                stats[agent]['calls'] += 1
                stats[agent]['seconds'] += get_seconds(duration)
            
        cur.close()
        conn.close()
        return stats, shift_start, now_pkt

    except Exception as e:
        return {"error": str(e)}, shift_start, now_pkt

def show_dashboard():
    while True:
        clear_screen()
        
        data, start_time, current_pkt = fetch_stats()
        
        current_time_str = current_pkt.strftime('%H:%M:%S')
        shift_label = start_time.strftime('%d %b, %I:%M %p')
        
        if "error" in data:
            print(f"🔄 Fetching Live Data... ({current_time_str} PKT)")
            print(f"\n❌ Database Error:\n{data['error']}")
            time.sleep(5)
            continue

        print("\n" + "━"*58)
        print(f"   📞  REAL-TIME SALES DASHBOARD (PKT ZONE)  📞")
        print("━"*58)
        print(f"   🇵🇰 Current PKT : {current_time_str}")
        print(f"   🚀 Data Since  : {shift_label} (PKT)")
        print("─"*58)
        print(f"{'AGENT':<15} | {'CALLS':<10} | {'TALK TIME':<12} | {'AVG CALL'}")
        print("─"*58)
        
        if not data:
            print(f"   Waiting for calls (Shift started {shift_label})...")
        
        total_calls = 0
        total_secs = 0

        for agent in sorted(data.keys()):
            calls = data[agent]['calls']
            secs = data[agent]['seconds']
            avg = secs // calls if calls > 0 else 0
            
            total_calls += calls
            total_secs += secs
            
            print(f"{agent:<15} | {calls:<10} | {format_time(secs):<12} | {format_time(avg)}")
        
        print("─"*58)
        print(f"{'TOTAL':<15} | {total_calls:<10} | {format_time(total_secs):<12}")
        print("━"*58)
        print("\n(Press Ctrl+C to stop)")
        
        time.sleep(2)

if __name__ == "__main__":
    show_dashboard()
from flask import Flask, request
import datetime

app = Flask(__name__)

# Store stats in memory (resets if you restart script)
agent_stats = {} 

def format_seconds(seconds):
    m, s = divmod(seconds, 60)
    h, m = divmod(m, 60)
    return f"{h:02d}:{m:02d}:{s:02d}"

@app.route('/3cx-webhook', methods=['POST'])
def receive_call_data():
    try:
        # 3CX sends data as JSON
        data = request.json
        print(f"\n[RECEIVED] Raw Data: {data}")

        # Extract Fields (We configure 3CX to send these keys)
        ext = data.get('agent_extension')
        duration_str = data.get('duration') # Format HH:MM:SS
        
        if not ext or not duration_str:
            return "Missing Data", 400

        # Parse Duration
        h, m, s = map(int, duration_str.split(':'))
        secs = h * 3600 + m * 60 + s

        # Update Stats
        if ext not in agent_stats:
            agent_stats[ext] = {'calls': 0, 'seconds': 0}
        
        agent_stats[ext]['calls'] += 1
        agent_stats[ext]['seconds'] += secs

        # --- LIVE DASHBOARD OUTPUT ---
        print("\n" + "="*40)
        print(f"📢 NEW CALL REPORTED for Agent {ext}")
        print(f"   Call Duration: {duration_str}")
        print("-" * 40)
        print(f"📊 LIVE STATS for {ext}:")
        print(f"   Total Calls : {agent_stats[ext]['calls']}")
        print(f"   Total Talk  : {format_seconds(agent_stats[ext]['seconds'])}")
        print("="*40)

        return "OK", 200

    except Exception as e:
        print(f"Error: {e}")
        return "Error", 500

if __name__ == '__main__':
    print("🚀 Listener running on Port 5000...")
    app.run(port=5000)
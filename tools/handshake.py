import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client
from openai import OpenAI
from serpapi import GoogleSearch

# Load environment variables
load_dotenv(Path(__file__).parent / '.env')

def check_supabase():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    
    if not url or not key or "your-" in key:
        print("❌ Supabase: Missing URL or Key in .env")
        return False
        
    try:
        supabase: Client = create_client(url, key)
        # Try a simple read (even if empty, it tests auth)
        # Assuming a table exists or just checking auth
        # We can just check if the client initialized without error for now, 
        # but a real call is better. Let's list tables or just 'auth'.
        # For now, client creation is local. A real call:
        response = supabase.table("leads").select("*").limit(1).execute()
        print("✅ Supabase: Connected! (Table 'leads' queried)")
        return True
    except Exception as e:
        print(f"❌ Supabase: Connection Failed. Error: {e}")
        return False

def check_openai():
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("❌ OpenAI: Missing Key in .env")
        return False
        
    try:
        client = OpenAI(api_key=api_key)
        client.models.list()
        print("✅ OpenAI: Connected!")
        return True
    except Exception as e:
        print(f"❌ OpenAI: Connection Failed. Error: {e}")
        return False

def check_serpapi():
    api_key = os.environ.get("SERPAPI_KEY")
    if not api_key:
        print("❌ SerpAPI: Missing Key in .env")
        return False
        
    try:
        search = GoogleSearch({"q": "coffee", "location": "Austin, Texas", "api_key": api_key})
        result = search.get_dict()
        if "error" in result:
             print(f"❌ SerpAPI: Connection Failed. Error: {result['error']}")
             return False
        print("✅ SerpAPI: Connected!")
        return True
    except Exception as e:
        print(f"❌ SerpAPI: Connection Failed. Error: {e}")
        return False

if __name__ == "__main__":
    print("--- B.L.A.S.T. Handshake Protocol ---")
    s = check_supabase()
    o = check_openai()
    g = check_serpapi()
    
    if s and o and g:
        print("\n✨ All Systems Operational. Ready to Build.")
    else:
        print("\n⚠️  Some systems failed. Check .env and Try Again.")

import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(dotenv_path='dashboard/.env')

url: str = os.environ.get("VITE_SUPABASE_URL")
key: str = os.environ.get("VITE_SUPABASE_KEY")

if not url or not key:
    print("Error: Supabase credentials not found in dashboard/.env")
    exit(1)

supabase: Client = create_client(url, key)

response = supabase.table('leads').select('*').order('created_at', desc=True).limit(5).execute()

print(f"Found {len(response.data)} recent leads:")
for lead in response.data:
    print(f"- {lead['company_name']} ({lead['match_score']}%) - Created: {lead['created_at']}")

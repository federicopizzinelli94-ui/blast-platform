import os
from supabase import create_client, Client
from dotenv import load_dotenv

load_dotenv(dotenv_path='dashboard/.env')

url: str = os.environ.get("VITE_SUPABASE_URL")
key: str = os.environ.get("VITE_SUPABASE_KEY")

supabase: Client = create_client(url, key)

response = supabase.table('products').select('id, name').limit(5).execute()

for p in response.data:
    print(f"ID: {p['id']} - Name: {p['name']}")

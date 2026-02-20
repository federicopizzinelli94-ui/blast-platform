import os
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv(Path(__file__).parent / '.env')

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Fetch the lead that was just updated (status='Generated')
response = supabase.table("leads").select("*").eq("company_name", "Montina Franciacorta").execute()
if response.data:
    print(response.data[0].get("notes"))
else:
    print("Lead not found.")

-- Create the Leads Table
create table public.leads (
  id uuid default gen_random_uuid() primary key,
  company_name text not null,
  website text,
  industry_vertical text, -- 'Premi', 'Etichette', 'Espositori'
  location text,
  status text default 'New', -- 'New', 'Generated', 'Sent', 'Rejected'
  email text,
  phone text,
  notes text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Create the Outreach Campaigns Table (Optional for now, but good to have)
create table public.outreach_campaigns (
  id uuid default gen_random_uuid() primary key,
  lead_id uuid references public.leads(id),
  generated_content text,
  status text default 'Draft',
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable Row Level Security (Good practice, even if public for now)
alter table public.leads enable row level security;
alter table public.outreach_campaigns enable row level security;

-- Create a policy that allows anyone to read/write (for this demo MVP)
-- WARNING: In production, you'd want strict user policies.
create policy "Enable all access for all users" on public.leads
for all using (true) with check (true);

create policy "Enable all access for all users" on public.outreach_campaigns
for all using (true) with check (true);

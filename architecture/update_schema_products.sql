-- Create Products Table
create table public.products (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  description text not null,
  target_keywords text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

-- Enable RLS for Products
alter table public.products enable row level security;
create policy "Enable all access" on public.products for all using (true) with check (true);

-- Update Leads Table to link to Products and store better contact info
alter table public.leads add column contact_person text;
alter table public.leads add column best_email_source text;
-- We can link leads to a specific product interest, or keep it loose.
-- Let's add it for tracking.
alter table public.leads add column interested_product_id uuid references public.products(id);

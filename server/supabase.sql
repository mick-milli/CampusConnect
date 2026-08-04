-- CampusConnect · Supabase schema
-- Run this once in your Supabase project: Dashboard → SQL Editor → New query →
-- paste this → Run. It creates one table per collection. Each row is
-- { id, data } where `data` is the full JSON object the app works with.
--
-- The server connects with the SERVICE ROLE key, which bypasses Row Level
-- Security. We still enable RLS with no policies so the public/anon API can
-- never read these tables directly.

create table if not exists cc_categories    (id text primary key, data jsonb not null);
create table if not exists cc_users         (id text primary key, data jsonb not null);
create table if not exists cc_services      (id text primary key, data jsonb not null);
create table if not exists cc_orders        (id text primary key, data jsonb not null);
create table if not exists cc_reviews       (id text primary key, data jsonb not null);
create table if not exists cc_notifications (id text primary key, data jsonb not null);
create table if not exists cc_messages      (id text primary key, data jsonb not null);

-- Lock the tables down to the service role only.
alter table cc_categories    enable row level security;
alter table cc_users         enable row level security;
alter table cc_services      enable row level security;
alter table cc_orders        enable row level security;
alter table cc_reviews       enable row level security;
alter table cc_notifications enable row level security;
alter table cc_messages      enable row level security;
